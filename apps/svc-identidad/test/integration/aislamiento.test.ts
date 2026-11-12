import { withTenant } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { prepararBase, registro, servidor, type Entorno } from './helpers.js';

let env: Entorno;
let app: FastifyInstance;
let A: { tenantId: string; usuarioId: string };
let B: { tenantId: string; usuarioId: string };

const registrar = async (slug: string) => {
  const r = await app.inject({ method: 'POST', url: '/registro', payload: registro(slug) });
  expect(r.statusCode).toBe(201);
  return r.json<{ tenantId: string; usuarioId: string }>();
};

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
  A = await registrar('a-aislamiento');
  B = await registrar('b-aislamiento');
});
afterAll(async () => {
  await app.close();
  await env.stop();
});

describe('aislamiento entre tenants (identidad_app)', () => {
  test('no ve membresías de otro tenant', async () => {
    const r = await withTenant(env.appPool, A.tenantId, (tx) => tx.query('select tenant_id, usuario_id from membresia'));
    expect(r.rows).toHaveLength(1);
    expect(r.rows.every((x) => x.tenant_id === A.tenantId)).toBe(true);
    expect(r.rows[0].usuario_id).toBe(A.usuarioId);
  });

  test('sin tenant activo no ve ninguna membresía', async () => {
    expect((await env.appPool.query('select 1 from membresia')).rowCount).toBe(0);
  });

  test('no puede insertar membresías en otro tenant (WITH CHECK)', async () => {
    await expect(
      withTenant(env.appPool, A.tenantId, (tx) =>
        tx.query(`insert into membresia (tenant_id, usuario_id, rol) values ($1, $2, 'recepcion')`, [B.tenantId, A.usuarioId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  test('perfil_medico y datos_fiscales también están aislados', async () => {
    await withTenant(env.appPool, A.tenantId, async (tx) => {
      await tx.query(`insert into perfil_medico (tenant_id, usuario_id, cedula_profesional) values ($1, $2, '123')`, [A.tenantId, A.usuarioId]);
      await tx.query(`insert into datos_fiscales (tenant_id, rfc) values ($1, 'XAXX010101000')`, [A.tenantId]);
    });
    for (const t of ['perfil_medico', 'datos_fiscales']) {
      const deB = await withTenant(env.appPool, B.tenantId, (tx) => tx.query(`select 1 from ${t}`));
      expect(deB.rowCount).toBe(0);
      const deA = await withTenant(env.appPool, A.tenantId, (tx) => tx.query(`select 1 from ${t}`));
      expect(deA.rowCount).toBe(1);
    }
  });

  test('fn_membresias_usuario devuelve las membresías del usuario sin tenant activo', async () => {
    const r = await env.appPool.query('select * from fn_membresias_usuario($1)', [A.usuarioId]);
    expect(r.rows).toEqual([{ tenant_id: A.tenantId, nombre: 'Consultorio a-aislamiento', slug: 'a-aislamiento', rol: 'medico', admin: true }]);
    expect((await env.appPool.query('select * from fn_membresias_usuario($1)', [A.tenantId])).rowCount).toBe(0);
  });

  test('identidad_app no puede ejecutar DELETE sobre outbox ni leer con rol ajeno; PUBLIC no ejecuta la función', async () => {
    await expect(env.appPool.query('delete from outbox')).rejects.toThrow(/permission denied/);
    const r = await env.migrator.query(
      `select has_function_privilege('public', 'fn_membresias_usuario(uuid)', 'EXECUTE') as publico,
              (select prosecdef from pg_proc where proname = 'fn_membresias_usuario') as definer`,
    );
    expect(r.rows[0]).toEqual({ publico: false, definer: true });
  });

  test('el rol de aplicación no es dueño ni omite RLS', async () => {
    const r = await env.appPool.query(
      `select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});
