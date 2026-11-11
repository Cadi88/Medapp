import { withTenant } from '@consultorio/platform';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { HASH_GENESIS } from '../../src/cadena.js';
import { verificarCadena } from '../../src/verificacion.js';
import { comoDueno, prepararBase, registrarN, tenantId, type Entorno } from './helpers.js';

let env: Entorno;
const A = tenantId();

beforeAll(async () => {
  env = await prepararBase();
  await registrarN(env, A, 3);
});
afterAll(async () => {
  await env.stop();
});

const comoApp = (sql: string, params: unknown[] = []) => withTenant(env.appPool, A, (tx) => tx.query(sql, params));
const hashDe = async (s: number): Promise<string> =>
  (await comoApp('select hash from evento_auditoria where secuencia = $1', [s])).rows[0].hash as string;

describe('trigger de integridad del encabezado de la cadena', () => {
  test('rechaza retroceder la secuencia (aunque el hash sea el de esa fila)', async () => {
    await expect(comoApp('update cadena set ultima_secuencia = 2, ultimo_hash = $1', [await hashDe(2)])).rejects.toThrow(/cadena/);
  });

  test('rechaza saltar secuencias y cambiar el hash sin avanzar', async () => {
    await expect(comoApp('update cadena set ultima_secuencia = ultima_secuencia + 2')).rejects.toThrow(/cadena/);
    await expect(comoApp("update cadena set ultimo_hash = repeat('c', 64)")).rejects.toThrow(/cadena/);
  });

  test('rechaza avanzar en uno si la fila no existe o su hash no coincide', async () => {
    await expect(comoApp('update cadena set ultima_secuencia = ultima_secuencia + 1, ultimo_hash = $1', [await hashDe(3)])).rejects.toThrow(
      /cadena/,
    );
  });

  test('rechaza cambiar el tenant del encabezado', async () => {
    await expect(comoApp('update cadena set tenant_id = $1', [tenantId()])).rejects.toThrow(/cadena|row-level/);
  });

  test('también aplica al dueño de la tabla', async () => {
    await expect(
      comoDueno(env, A, 'update cadena set ultima_secuencia = 1, ultimo_hash = (select hash from evento_auditoria where secuencia = 1)'),
    ).rejects.toThrow(/cadena/);
  });

  test('un encabezado nuevo solo puede nacer en 0 con el hash génesis', async () => {
    const B = tenantId();
    await expect(withTenant(env.appPool, B, (tx) => tx.query('insert into cadena values ($1, 5, $2)', [B, 'f'.repeat(64)]))).rejects.toThrow(
      /cadena/,
    );
    await withTenant(env.appPool, B, (tx) => tx.query('insert into cadena values ($1, 0, $2)', [B, HASH_GENESIS]));
  });

  test('tras los intentos rechazados la cadena sigue íntegra y sigue creciendo', async () => {
    await registrarN(env, A, 2);
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: true });
  });
});

describe('FORCE RLS sobre el dueño', () => {
  test('el dueño (migrador) sin tenant no ve filas de evento_auditoria; con su tenant sí', async () => {
    expect((await env.migrator.query('select * from evento_auditoria')).rowCount).toBe(0);
    expect(await comoDueno(env, A, 'select * from evento_auditoria')).toBe(5);
  });

  test('la política de listado de fn_tenants_auditados no la activa el rol de aplicación', async () => {
    const c = await env.appPool.connect();
    try {
      await c.query("select set_config('app.listado_tenants', 'si', false)");
      expect((await c.query('select count(*)::int n from evento_auditoria')).rows[0].n).toBe(0);
    } finally {
      await c.query("select set_config('app.listado_tenants', '', false)");
      c.release();
    }
  });
});
