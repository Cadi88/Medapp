import { withTenant } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { miembroSchema } from '@consultorio/contracts';
import { agregarMiembro, conToken, crearConsultorio, prepararBase, servidor, tokenDe, type Consultorio, type Entorno } from './helpers.js';
import { crearAdminConToken } from './helpers-mfa.js';

let env: Entorno;
let app: FastifyInstance;
const q = async (sql: string, params: unknown[] = []) => (await env.migrator.query(sql, params)).rows;
/** Tablas con RLS FORCE: se consultan dentro del tenant, como el rol de aplicación. */
const qt = async (tenantId: string, sql: string, params: unknown[] = []) => (await withTenant(env.appPool, tenantId, (tx) => tx.query(sql, params))).rows;
const patch = (token: string, id: string, payload: unknown) =>
  app.inject({ method: 'PATCH', url: `/miembros/${id}`, payload: payload as object, headers: conToken(token) });
const ultimoEvento = async (tipo: string, tenantId: string) =>
  (await q('select payload from outbox where type = $1 and tenant_id = $2 order by event_id desc limit 1', [tipo, tenantId]))[0]?.payload;

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
});
afterAll(async () => {
  await app.close();
  await env.stop();
});

describe('PATCH /miembros/:usuarioId', () => {
  let c: Consultorio;
  let recepcionId: string;
  let tokenRecepcion: string;
  beforeAll(async () => {
    c = await crearConsultorio(app, 'edicion-uno');
    recepcionId = await agregarMiembro(app, c, 'recep@edicion.mx', 'recepcion');
    // Token obtenido mientras es recepción (como médico exigiría MFA); el rol vigente se lee de la BD en cada petición.
    tokenRecepcion = await tokenDe(app, 'recep@edicion.mx', c.tenantId, { mfa: false });
  });

  test('cambia rol, responde el miembro y emite miembro.actualizado', async () => {
    const r = await patch(c.adminToken, recepcionId, { rol: 'medico' });
    expect(r.statusCode).toBe(200);
    expect(miembroSchema.parse(r.json())).toMatchObject({ usuarioId: recepcionId, rol: 'medico', admin: false, email: 'recep@edicion.mx' });
    expect(await ultimoEvento('miembro.actualizado', c.tenantId)).toMatchObject({
      actor_id: c.adminId,
      data: { usuarioId: recepcionId, rol: 'medico', admin: false },
    });
  });

  test('pasar a recepción conserva perfil_medico', async () => {
    await qt(c.tenantId, `INSERT INTO perfil_medico (tenant_id, usuario_id, cedula_profesional) VALUES ($1, $2, '7654321')`, [c.tenantId, recepcionId]);
    const r = await patch(c.adminToken, recepcionId, { rol: 'recepcion' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ rol: 'recepcion', perfilMedico: { cedulaProfesional: '7654321' } });
    expect(await qt(c.tenantId, 'select 1 from perfil_medico where usuario_id = $1', [recepcionId])).toHaveLength(1);
  });

  test('concede y quita admin de otro miembro', async () => {
    expect((await patch(c.adminToken, recepcionId, { admin: true })).json()).toMatchObject({ admin: true });
    expect((await patch(c.adminToken, recepcionId, { admin: false })).json()).toMatchObject({ admin: false });
  });

  test('Review Focus 3: el único admin no puede quitarse admin → 409', async () => {
    const r = await patch(c.adminToken, c.adminId, { admin: false });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'CONFLICTO' });
    expect(await q('select admin from membresia where usuario_id = $1', [c.adminId])).toEqual([{ admin: true }]);
  });

  test('PATCH vacío o inválido → 400; recepción no admin → 403; otro consultorio → 404', async () => {
    expect((await patch(c.adminToken, recepcionId, {})).statusCode).toBe(400);
    expect((await patch(c.adminToken, recepcionId, { rol: 'admin' })).statusCode).toBe(400);
    expect((await patch(c.adminToken, 'no-uuid', { rol: 'medico' })).statusCode).toBe(400);
    expect((await patch(tokenRecepcion, recepcionId, { rol: 'medico' })).statusCode).toBe(403);
    const otro = await crearConsultorio(app, 'edicion-dos');
    const ajeno = await agregarMiembro(app, otro, 'ajeno@edicion.mx', 'recepcion');
    expect((await patch(c.adminToken, ajeno, { rol: 'medico' })).statusCode).toBe(404);
    expect(await q('select rol from membresia where usuario_id = $1', [ajeno])).toEqual([{ rol: 'recepcion' }]);
  });

  test('Review Focus 3: dos admins quitándose admin a la vez → uno 200, otro 409; queda 1 admin', async () => {
    const c2 = await crearConsultorio(app, 'edicion-carrera');
    const b = await crearAdminConToken(app, c2, 'segundo@edicion.mx');
    const [x, y] = await Promise.all([patch(c2.adminToken, c2.adminId, { admin: false }), patch(b.token, b.id, { admin: false })]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect((await q('select count(*)::int n from membresia where tenant_id = $1 and admin', [c2.tenantId]))[0].n).toBe(1);
  });
});
