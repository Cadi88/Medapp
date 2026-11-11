import { withTenant } from '@consultorio/platform';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { leer, prepararBase, registrarN, tenantId, type Entorno } from './helpers.js';

let env: Entorno;
const A = tenantId();
const B = tenantId();

beforeAll(async () => {
  env = await prepararBase();
  await registrarN(env, A, 2);
  await registrarN(env, B, 1);
});
afterAll(async () => {
  await env.stop();
});

describe('privilegios del rol de aplicación', () => {
  test('auditoria_app no puede UPDATE ni DELETE ni TRUNCATE en evento_auditoria', async () => {
    await expect(withTenant(env.appPool, A, (tx) => tx.query('delete from evento_auditoria'))).rejects.toThrow(/permission denied/);
    await expect(withTenant(env.appPool, A, (tx) => tx.query("update evento_auditoria set detalle = '{}'"))).rejects.toThrow(/permission denied/);
    await expect(env.appPool.query('truncate evento_auditoria')).rejects.toThrow(/permission denied/);
    expect((await leer(env, A)).length).toBe(2);
  });

  test('no puede borrar la cadena, pero sí actualizarla', async () => {
    await expect(withTenant(env.appPool, A, (tx) => tx.query('delete from cadena'))).rejects.toThrow(/permission denied/);
    const r = await withTenant(env.appPool, A, (tx) => tx.query('update cadena set ultima_secuencia = ultima_secuencia'));
    expect(r.rowCount).toBe(1);
  });

  test('RLS: cada tenant ve solo sus filas y sin tenant no ve ninguna', async () => {
    expect((await leer(env, B)).length).toBe(1);
    const sinTenant = await env.appPool.query('select * from evento_auditoria');
    expect(sinTenant.rows).toEqual([]);
    const cadenas = await withTenant(env.appPool, A, (tx) => tx.query('select tenant_id from cadena'));
    expect(cadenas.rows).toEqual([{ tenant_id: A }]);
  });

  test('fn_tenants_auditados devuelve todos los tenants con cadena (solo su id) al rol de aplicación', async () => {
    const r = await env.appPool.query('select * from fn_tenants_auditados()');
    expect(r.fields.map((f) => f.name)).toEqual(['tenant_id']);
    expect(r.rows.map((x) => x.tenant_id).sort()).toEqual([A, B].sort());
  });

  test('PUBLIC no puede ejecutar fn_tenants_auditados', async () => {
    const r = await env.migrator.query("select has_function_privilege('public', 'fn_tenants_auditados()', 'EXECUTE') as ok");
    expect(r.rows[0].ok).toBe(false);
  });
});
