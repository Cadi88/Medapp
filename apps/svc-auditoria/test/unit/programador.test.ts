import type pg from 'pg';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LOCK_VERIFICACION, ejecutarVerificacion, iniciarProgramador } from '../../src/programador.js';

const A = '0194a1b2-0000-7000-8000-00000000000a';
const B = '0194a1b2-0000-7000-8000-00000000000b';

function dobles(opts: { lock?: boolean; tenants?: string[]; falloListado?: boolean } = {}) {
  const sqls: { sql: string; params?: unknown[] }[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      sqls.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: opts.lock ?? true }] };
      if (sql.includes('fn_tenants_auditados')) {
        if (opts.falloListado) throw new Error('boom');
        return { rows: (opts.tenants ?? [A, B]).map((tenant_id) => ({ tenant_id })) };
      }
      return { rows: [] };
    }),
    release,
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool;
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  return { pool, client, sqls, release, logger: logger as unknown as Logger, log: logger };
}

describe('ejecutarVerificacion', () => {
  test('si no obtiene el advisory lock no verifica nada (otra réplica lo hace)', async () => {
    const d = dobles({ lock: false });
    const verificar = vi.fn();
    const r = await ejecutarVerificacion({ pool: d.pool, logger: d.logger, verificar });
    expect(r).toEqual({ ejecutada: false, tenants: 0, rotas: 0 });
    expect(verificar).not.toHaveBeenCalled();
    expect(d.sqls.some((s) => s.sql.includes('pg_advisory_unlock'))).toBe(false);
    expect(d.release).toHaveBeenCalledOnce();
    expect(d.sqls[0]!.params).toEqual([LOCK_VERIFICACION]);
  });

  test('verifica cada tenant, registra la alerta de las cadenas rotas y libera el lock', async () => {
    const d = dobles();
    const verificar = vi.fn(async (_p: pg.Pool, tenantId: string) =>
      tenantId === A ? { valida: true } : { valida: false, rotaEnSecuencia: 4 },
    );
    const r = await ejecutarVerificacion({ pool: d.pool, logger: d.logger, verificar });
    expect(r).toEqual({ ejecutada: true, tenants: 2, rotas: 1 });
    expect(d.log.error).toHaveBeenCalledOnce();
    expect(d.log.error).toHaveBeenCalledWith({ alerta: 'cadena_auditoria_rota', tenant_id: B, secuencia: 4 }, expect.any(String));
    const unlock = d.sqls.find((s) => s.sql.includes('pg_advisory_unlock'));
    expect(unlock?.params).toEqual([LOCK_VERIFICACION]);
    expect(d.release).toHaveBeenCalledOnce();
  });

  test('un tenant cuya verificación lanza error no impide verificar el resto y se registra', async () => {
    const d = dobles();
    const verificar = vi.fn(async (_p: pg.Pool, tenantId: string) => {
      if (tenantId === A) throw new Error('db caída');
      return { valida: true };
    });
    const r = await ejecutarVerificacion({ pool: d.pool, logger: d.logger, verificar });
    expect(r).toEqual({ ejecutada: true, tenants: 2, rotas: 0 });
    expect(verificar).toHaveBeenCalledTimes(2);
    expect(d.log.error).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: A, err: expect.any(Error) }), expect.any(String));
  });

  test('si el listado falla igual libera el lock y la conexión, y propaga el error', async () => {
    const d = dobles({ falloListado: true });
    await expect(ejecutarVerificacion({ pool: d.pool, logger: d.logger, verificar: vi.fn() })).rejects.toThrow('boom');
    expect(d.sqls.some((s) => s.sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(d.release).toHaveBeenCalledOnce();
  });
});

describe('iniciarProgramador', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('programa la ejecución a las 03:00 locales, corre y reprograma para el día siguiente', async () => {
    vi.setSystemTime(new Date('2026-06-10T08:00:00Z'));
    const ejecutar = vi.fn(async () => ({ ejecutada: true, tenants: 0, rotas: 0 }));
    const d = dobles();
    const p = iniciarProgramador({ pool: d.pool, logger: d.logger, ejecutar });
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(ejecutar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    await p.stop();
    await vi.advanceTimersByTimeAsync(48 * 3600_000);
    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  test('un error en la ejecución se registra y no impide la siguiente', async () => {
    vi.setSystemTime(new Date('2026-06-10T08:59:00Z'));
    const ejecutar = vi.fn().mockRejectedValueOnce(new Error('fallo')).mockResolvedValue({ ejecutada: true, tenants: 0, rotas: 0 });
    const d = dobles();
    const p = iniciarProgramador({ pool: d.pool, logger: d.logger, ejecutar });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.log.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.any(String));
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    await p.stop();
  });

  test('stop espera a que termine una ejecución en curso', async () => {
    vi.setSystemTime(new Date('2026-06-10T08:59:59Z'));
    let fin!: () => void;
    const ejecutar = vi.fn(() => new Promise<{ ejecutada: boolean; tenants: number; rotas: number }>((r) => (fin = () => r({ ejecutada: true, tenants: 0, rotas: 0 }))));
    const d = dobles();
    const p = iniciarProgramador({ pool: d.pool, logger: d.logger, ejecutar });
    await vi.advanceTimersByTimeAsync(1000);
    let parado = false;
    const stop = p.stop().then(() => (parado = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(parado).toBe(false);
    fin();
    await stop;
    expect(parado).toBe(true);
  });
});
