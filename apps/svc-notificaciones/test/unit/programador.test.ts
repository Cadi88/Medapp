import type pg from 'pg';
import { describe, expect, test, vi } from 'vitest';
import { LOCK_PROGRAMADOR, iniciarProgramador } from '../../src/programador.js';

function poolFalso(obtieneLock: boolean) {
  const consultas: string[] = [];
  const cliente = {
    query: vi.fn(async (sql: string) => {
      consultas.push(sql);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: obtieneLock }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => cliente) } as unknown as pg.Pool, cliente, consultas };
}

const reloj = () => new Date('2031-05-01T16:00:00.000Z');

describe('iniciarProgramador', () => {
  test('sin el candado no hace nada (ni lista consultorios) y no intenta soltarlo', async () => {
    const { pool, cliente, consultas } = poolFalso(false);
    const p = iniciarProgramador({ pool, puertos: {} as never, reloj, webOrigen: 'http://web.test' }, { reloj, intervaloMs: 3_600_000 });
    await p.correrAhora();
    await p.detener();
    expect(consultas).toHaveLength(1);
    expect(cliente.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'), [LOCK_PROGRAMADOR]);
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  test('con el candado lista los consultorios y lo suelta al terminar aunque falle', async () => {
    const { pool, cliente, consultas } = poolFalso(true);
    cliente.query.mockImplementation(async (sql: string) => {
      consultas.push(sql);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: true }] };
      if (sql.includes('fn_consultorios')) throw new Error('base caída');
      return { rows: [] };
    });
    const error = vi.fn();
    const p = iniciarProgramador({ pool, puertos: {} as never, reloj, webOrigen: 'http://web.test', logger: { error } as never }, { reloj, intervaloMs: 3_600_000 });
    await p.correrAhora();
    await p.detener();
    expect(consultas.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
    expect(error).toHaveBeenCalled();
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });
});
