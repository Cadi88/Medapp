import { altaMiembroRespuestaSchema } from '@consultorio/contracts';
import { withTenant } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  PASSWORD,
  activarTotpEIniciarSesion,
  agregarMiembro,
  conToken,
  crearConsultorio,
  iniciarSesion,
  invitarMiembro,
  pedirToken,
  prepararBase,
  servidor,
  type Consultorio,
  type Entorno,
} from './helpers.js';
import { crearAdminConToken } from './helpers-mfa.js';

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let env: Entorno;
let app: FastifyInstance;
const q = async (sql: string, params: unknown[] = []) => (await env.migrator.query(sql, params)).rows;
const borrar = (token: string, id: string) => app.inject({ method: 'DELETE', url: `/miembros/${id}`, headers: conToken(token) });
const eventos = (tipo: string, tenantId: string) =>
  q("select payload from outbox where type = $1 and tenant_id = $2 order by event_id", [tipo, tenantId]).then((r) => r.map((x) => x.payload));

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
});
afterAll(async () => {
  await app.close();
  await env.stop();
});

describe('POST /miembros', () => {
  let c: Consultorio;
  beforeAll(async () => {
    c = await crearConsultorio(app, 'miembros-uno');
  });

  test('crea usuario nuevo, membresía y emite usuario.vinculado con actor y trace_id', async () => {
    const r = await invitarMiembro(app, c.adminToken, { email: 'Nueva@Miembros.MX', nombre: 'Nueva', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD });
    expect(r.statusCode).toBe(201);
    const { usuarioId, cuentaCreada } = altaMiembroRespuestaSchema.parse(r.json());
    expect(usuarioId).toMatch(UUIDV7);
    expect(cuentaCreada).toBe(true);
    expect(await q('select rol, admin from membresia where tenant_id = $1 and usuario_id = $2', [c.tenantId, usuarioId])).toEqual([
      { rol: 'recepcion', admin: false },
    ]);
    const [u] = await q('select email, name from "user" where id = $1', [usuarioId]);
    expect(u).toEqual({ email: 'nueva@miembros.mx', name: 'Nueva' });
    const ev = (await eventos('usuario.vinculado', c.tenantId)).find((e) => e.data.usuarioId === usuarioId);
    expect(ev).toMatchObject({ actor_id: c.adminId, trace_id: r.headers['x-trace-id'], data: { usuarioId, nombre: 'Nueva', rol: 'recepcion', admin: false } });
    expect(ev).toMatchObject({ version: 2 });
    // La persona inicia sesión con la contraseña temporal, pero debe cambiarla antes de obtener token.
    const cookie = await iniciarSesion(app, 'nueva@miembros.mx');
    const t = await pedirToken(app, cookie, c.tenantId);
    expect(t.statusCode).toBe(403);
    expect(t.json()).toMatchObject({ code: 'PASSWORD_TEMPORAL' });
  });

  test('recepción no admin no puede dar de alta miembros → 403', async () => {
    const email = 'recep-sin-admin@miembros.mx';
    await agregarMiembro(app, c, email, 'recepcion');
    const token = (await pedirToken(app, await iniciarSesion(app, email), c.tenantId)).json().token;
    const r = await invitarMiembro(app, token, { email: 'nadie@miembros.mx', nombre: 'N', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('PROHIBIDO');
  });

  test('recepción con permiso admin sí puede dar de alta un miembro con admin', async () => {
    const email = 'recep-admin@miembros.mx';
    await agregarMiembro(app, c, email, 'recepcion', true);
    const { cookie } = await activarTotpEIniciarSesion(app, email);
    const token = (await pedirToken(app, cookie, c.tenantId)).json().token;
    const r = await invitarMiembro(app, token, { email: 'medico-admin@miembros.mx', nombre: 'M', rol: 'medico', admin: true, passwordTemporal: PASSWORD });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ rol: 'medico', admin: true });
  });

  test('recepción no puede invitar miembros → 403', async () => {
    await agregarMiembro(app, c, 'recep@miembros.mx', 'recepcion');
    const cookie = await iniciarSesion(app, 'recep@miembros.mx');
    const token = (await pedirToken(app, cookie, c.tenantId)).json().token;
    const r = await invitarMiembro(app, token, { email: 'x@miembros.mx', nombre: 'X', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('PROHIBIDO');
    expect(await q(`select 1 from "user" where email = 'x@miembros.mx'`)).toHaveLength(0);
  });

  test('sin token → 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/miembros', payload: {} });
    expect(r.statusCode).toBe(401);
  });

  test('ya es miembro → 409 CONFLICTO y no cambia nada', async () => {
    await agregarMiembro(app, c, 'doble@miembros.mx', 'recepcion');
    const antes = await q('select count(*)::int n from outbox');
    const r = await invitarMiembro(app, c.adminToken, { email: 'doble@miembros.mx', nombre: 'Doble', rol: 'medico', admin: false, passwordTemporal: PASSWORD });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('CONFLICTO');
    expect(await q('select count(*)::int n from outbox')).toEqual(antes);
    expect(await q(`select m.rol from membresia m join "user" u on u.id = m.usuario_id where u.email = 'doble@miembros.mx'`)).toEqual([{ rol: 'recepcion' }]);
  });

  test('email de un usuario existente en otro consultorio: se vincula sin crear usuario ni cambiar su contraseña', async () => {
    const otro = await crearConsultorio(app, 'miembros-otro');
    const [antes] = await q(`select u.id, a.password from "user" u join account a on a."userId" = u.id where u.email = $1`, [otro.adminEmail]);
    const usuariosAntes = (await q('select count(*)::int n from "user"'))[0].n;
    const r = await invitarMiembro(app, c.adminToken, { email: otro.adminEmail, nombre: 'Otro Nombre', rol: 'medico', admin: false, passwordTemporal: 'otra-temporal-999' });
    expect(r.statusCode).toBe(201);
    // La contraseña temporal no se aplicó: el sitio no debe mostrarla.
    expect(altaMiembroRespuestaSchema.parse(r.json())).toEqual({ usuarioId: antes.id, rol: 'medico', admin: false, cuentaCreada: false });
    expect((await q('select count(*)::int n from "user"'))[0].n).toBe(usuariosAntes);
    const [despues] = await q(`select u.name, a.password from "user" u join account a on a."userId" = u.id where u.id = $1`, [antes.id]);
    expect(despues.password).toBe(antes.password);
    expect(despues.name).toBe('Admin Prueba');
    expect(await q('select rol from membresia where tenant_id = $1 and usuario_id = $2', [c.tenantId, antes.id])).toEqual([{ rol: 'medico' }]);
    // Su contraseña original sigue funcionando; la temporal enviada no.
    const login = (password: string) =>
      app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email: otro.adminEmail, password }, headers: { origin: 'http://localhost:3000' } });
    expect((await login(PASSWORD)).statusCode).toBe(200);
    expect((await login('otra-temporal-999')).statusCode).toBe(401);
  });

  test.each([
    ['rol desconocido', { rol: 'root' }],
    ['admin como rol (modelo anterior)', { rol: 'admin' }],
    ['sin admin', { admin: undefined }],
    ['contraseña corta', { passwordTemporal: '123' }],
    ['email inválido', { email: 'nope' }],
    ['nombre vacío', { nombre: '' }],
    ['campo extra', { extra: 1 }],
  ])('%s → 400 VALIDACION y no crea nada', async (_n, cambio) => {
    const base = { email: 'valido@miembros.mx', nombre: 'Valido', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD };
    const r = await invitarMiembro(app, c.adminToken, { ...base, ...cambio });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('VALIDACION');
    expect(r.body).not.toContain(PASSWORD);
    expect(await q(`select 1 from "user" where email = 'valido@miembros.mx'`)).toHaveLength(0);
  });

  test('si la transacción de la membresía falla se borra el usuario creado (500 sin detalles)', async () => {
    await env.migrator.query(`create or replace function _falla() returns trigger language plpgsql as $$ begin raise exception 'boom interno'; end $$`);
    await env.migrator.query('create trigger _falla_membresia before insert on membresia for each row execute function _falla()');
    try {
      const r = await invitarMiembro(app, c.adminToken, { email: 'fallo@miembros.mx', nombre: 'Fallo', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD });
      expect(r.statusCode).toBe(500);
      expect(r.json()).toEqual({ code: 'INTERNO', message: 'Error interno' });
      expect(await q(`select 1 from "user" where email = 'fallo@miembros.mx'`)).toHaveLength(0);
      expect(await q('select 1 from account a left join "user" u on u.id = a."userId" where u.id is null')).toHaveLength(0);
    } finally {
      await env.migrator.query('drop trigger _falla_membresia on membresia');
    }
  });

  test('si falla al vincular a un usuario existente, ese usuario NO se borra', async () => {
    const otro = await crearConsultorio(app, 'miembros-existente');
    await env.migrator.query(`create or replace function _falla() returns trigger language plpgsql as $$ begin raise exception 'boom interno'; end $$`);
    await env.migrator.query('create trigger _falla_membresia before insert on membresia for each row execute function _falla()');
    try {
      const r = await invitarMiembro(app, c.adminToken, { email: otro.adminEmail, nombre: 'X', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD });
      expect(r.statusCode).toBe(500);
    } finally {
      await env.migrator.query('drop trigger _falla_membresia on membresia');
    }
    expect(await q('select 1 from "user" where email = $1', [otro.adminEmail])).toHaveLength(1);
  });

  test('dos invitaciones simultáneas del mismo email nuevo → un solo usuario y una sola membresía', async () => {
    const email = 'carrera@miembros.mx';
    const cuerpo = { email, nombre: 'Carrera', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD };
    const [a, b] = await Promise.all([invitarMiembro(app, c.adminToken, cuerpo), invitarMiembro(app, c.adminToken, cuerpo)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await q('select 1 from "user" where email = $1', [email])).toHaveLength(1);
    expect(await q('select 1 from membresia m join "user" u on u.id = m.usuario_id where u.email = $1', [email])).toHaveLength(1);
  });
});

describe('DELETE /miembros/:usuarioId', () => {
  let c: Consultorio;
  beforeAll(async () => {
    c = await crearConsultorio(app, 'miembros-del');
  });

  test('borra la membresía, emite usuario.desvinculado y deja intacto el usuario global', async () => {
    const id = await agregarMiembro(app, c, 'baja@del.mx', 'recepcion');
    const r = await borrar(c.adminToken, id);
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe('');
    expect(await q('select 1 from membresia where usuario_id = $1', [id])).toHaveLength(0);
    expect(await q('select 1 from "user" where id = $1', [id])).toHaveLength(1);
    const ev = (await eventos('usuario.desvinculado', c.tenantId)).find((e) => e.data.usuarioId === id);
    expect(ev).toMatchObject({ actor_id: c.adminId, trace_id: r.headers['x-trace-id'], data: { usuarioId: id } });
  });

  test('borrar a un médico con perfil también elimina su perfil', async () => {
    const id = await agregarMiembro(app, c, 'medico@del.mx', 'medico');
    await withTenant(env.appPool, c.tenantId, (tx) =>
      tx.query(`insert into perfil_medico (tenant_id, usuario_id, cedula_profesional) values ($1, $2, '1234567')`, [c.tenantId, id]),
    );
    expect((await borrar(c.adminToken, id)).statusCode).toBe(204);
    expect((await withTenant(env.appPool, c.tenantId, (tx) => tx.query('select 1 from perfil_medico where usuario_id = $1', [id]))).rowCount).toBe(0);
  });

  test('no se puede eliminar al último admin → 409 CONFLICTO', async () => {
    const r = await borrar(c.adminToken, c.adminId);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('CONFLICTO');
    expect(await q('select 1 from membresia where usuario_id = $1', [c.adminId])).toHaveLength(1);
    expect(await q("select 1 from outbox where type = 'usuario.desvinculado' and payload->'data'->>'usuarioId' = $1", [c.adminId])).toHaveLength(0);
  });

  test('el último admin no se elimina aunque haya otros miembros sin admin → 409', async () => {
    const solo = await crearConsultorio(app, 'miembros-solo-admin');
    await agregarMiembro(app, solo, 'medico@solo.mx', 'medico');
    expect((await borrar(solo.adminToken, solo.adminId)).statusCode).toBe(409);
  });

  test('con dos admins uno puede salir', async () => {
    const id = await agregarMiembro(app, c, 'admin2@del.mx', 'recepcion', true);
    expect((await borrar(c.adminToken, id)).statusCode).toBe(204);
  });

  test('miembro inexistente o de otro consultorio → 404 NO_ENCONTRADO', async () => {
    const otro = await crearConsultorio(app, 'miembros-del-otro');
    const r1 = await borrar(c.adminToken, otro.adminId);
    expect(r1.statusCode).toBe(404);
    expect(r1.json().code).toBe('NO_ENCONTRADO');
    expect((await borrar(c.adminToken, '0190aaaa-0000-7000-8000-000000000099')).statusCode).toBe(404);
    expect(await q('select 1 from membresia where usuario_id = $1', [otro.adminId])).toHaveLength(1);
  });

  test('id que no es UUID → 400 VALIDACION', async () => {
    const r = await borrar(c.adminToken, 'no-uuid');
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('VALIDACION');
  });

  test('recepción no puede eliminar miembros → 403', async () => {
    const id = await agregarMiembro(app, c, 'recep@del.mx', 'recepcion');
    const token = (await pedirToken(app, await iniciarSesion(app, 'recep@del.mx'), c.tenantId)).json().token;
    const r = await borrar(token, id);
    expect(r.statusCode).toBe(403);
    expect(await q('select 1 from membresia where usuario_id = $1', [id])).toHaveLength(1);
  });

  test('dos admins que se eliminan a la vez nunca dejan el consultorio sin admin', async () => {
    for (let i = 0; i < 3; i++) {
      const par = await crearConsultorio(app, `miembros-carrera-${i}`);
      const emailB = `adminb-${i}@del.mx`;
      const idB = await agregarMiembro(app, par, emailB, 'medico', true);
      const { cookie } = await activarTotpEIniciarSesion(app, emailB);
      const tokenB = (await pedirToken(app, cookie, par.tenantId)).json().token;
      const [a, b] = await Promise.all([borrar(par.adminToken, idB), borrar(tokenB, par.adminId)]);
      // La segunda baja ya no tiene actor vigente (fue removido por la primera): 403.
      expect([a.statusCode, b.statusCode].sort()).toEqual([204, 403]);
      const admins = await q("select 1 from membresia where tenant_id = $1 and admin = true", [par.tenantId]);
      expect(admins).toHaveLength(1);
    }
  });
});

describe('actor removido con token aún vigente', () => {
  test('no puede volver a vincularse, ni eliminar admins, ni editar datos', async () => {
    const c = await crearConsultorio(app, 'removido');
    const b = await crearAdminConToken(app, c, 'adminb@removido.mx');
    const idC = await agregarMiembro(app, c, 'adminc@removido.mx', 'medico', true);
    expect((await borrar(c.adminToken, b.id)).statusCode).toBe(204);

    const antes = (await q('select count(*)::int n from outbox'))[0].n;
    const re = await invitarMiembro(app, b.token, { email: 'adminb@removido.mx', nombre: 'B', rol: 'medico', admin: true, passwordTemporal: PASSWORD });
    expect(re.statusCode).toBe(403);
    expect(re.json().code).toBe('PROHIBIDO');
    expect(await q('select 1 from membresia where tenant_id = $1 and usuario_id = $2', [c.tenantId, b.id])).toHaveLength(0);

    const nuevo = await invitarMiembro(app, b.token, { email: 'cuentanueva@removido.mx', nombre: 'N', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD });
    expect(nuevo.statusCode).toBe(403);
    expect(await q("select 1 from \"user\" where email = 'cuentanueva@removido.mx'")).toHaveLength(0);

    expect((await borrar(b.token, idC)).statusCode).toBe(403);
    expect((await borrar(b.token, c.adminId)).statusCode).toBe(403);
    expect(await q("select 1 from membresia where tenant_id = $1 and admin = true", [c.tenantId])).toHaveLength(2);

    const fiscal = await app.inject({
      method: 'PUT',
      url: '/datos-fiscales',
      payload: { rfc: 'XAXX010101000', razonSocial: 'X', regimenFiscal: '601', cp: '06600' },
      headers: conToken(b.token),
    });
    expect(fiscal.statusCode).toBe(403);
    expect(await q('select count(*)::int n from outbox')).toEqual([{ n: antes }]);
  });

  test('un médico removido no puede editar su perfil con el token anterior', async () => {
    const c = await crearConsultorio(app, 'removido-medico');
    const id = await agregarMiembro(app, c, 'medico@removido.mx', 'medico');
    const { cookie } = await activarTotpEIniciarSesion(app, 'medico@removido.mx');
    const token = (await pedirToken(app, cookie, c.tenantId)).json().token;
    expect((await borrar(c.adminToken, id)).statusCode).toBe(204);
    const r = await app.inject({ method: 'PUT', url: `/medicos/${id}/perfil`, payload: { cedulaProfesional: '1234567' }, headers: conToken(token) });
    expect(r.statusCode).toBe(403);
  });
});
