import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  ORIGEN,
  PASSWORD,
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

let env: Entorno;
let app: FastifyInstance;
let c: Consultorio;
const q = async (sql: string, params: unknown[] = []) => (await env.migrator.query(sql, params)).rows;
const bandera = async (email: string) => (await q('select "debeCambiarPassword" as b from "user" where email = $1', [email]))[0]?.b;
const reiniciar = (token: string, id: string, passwordTemporal = 'temporal-nueva-1') =>
  app.inject({ method: 'POST', url: `/miembros/${id}/password-temporal`, payload: { passwordTemporal }, headers: conToken(token) });
const cambiar = (cookie: string, currentPassword: string, newPassword: string) =>
  app.inject({ method: 'POST', url: '/auth/change-password', payload: { currentPassword, newPassword }, headers: { origin: ORIGEN, cookie } });
const invitar = async (email: string) => {
  const r = await invitarMiembro(app, c.adminToken, { email, nombre: 'Nuevo', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD });
  expect(r.statusCode).toBe(201);
  return r.json<{ usuarioId: string }>().usuarioId;
};

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
  c = await crearConsultorio(app, 'pwtemp');
});
afterAll(async () => {
  await app.close();
  await env.stop();
});

describe('contraseña temporal al invitar', () => {
  test('miembro nuevo con contraseña temporal → 403 PASSWORD_TEMPORAL al pedir token', async () => {
    await invitar('temp1@pw.mx');
    expect(await bandera('temp1@pw.mx')).toBe(true);
    const r = await pedirToken(app, await iniciarSesion(app, 'temp1@pw.mx'), c.tenantId);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ code: 'PASSWORD_TEMPORAL' });
  });

  test('tras change-password obtiene token y se revocan sus otras sesiones', async () => {
    await invitar('temp2@pw.mx');
    const otra = await iniciarSesion(app, 'temp2@pw.mx');
    const actual = await iniciarSesion(app, 'temp2@pw.mx');
    expect((await cambiar(actual, PASSWORD, 'clave-definitiva-1')).statusCode).toBe(200);
    expect(await bandera('temp2@pw.mx')).toBe(false);
    expect((await pedirToken(app, actual, c.tenantId)).statusCode).toBe(200);
    expect((await pedirToken(app, otra, c.tenantId)).statusCode).toBe(401);
  });

  test('un change-password fallido no baja la bandera', async () => {
    await invitar('temp3@pw.mx');
    const cookie = await iniciarSesion(app, 'temp3@pw.mx');
    expect((await cambiar(cookie, 'incorrecta-12345', 'clave-definitiva-1')).statusCode).toBe(400);
    expect(await bandera('temp3@pw.mx')).toBe(true);
  });

  test('vincular un usuario existente no activa la bandera', async () => {
    const otro = await crearConsultorio(app, 'pwtemp-otro');
    expect(await bandera(otro.adminEmail)).toBe(false);
    const e = await invitarMiembro(app, c.adminToken, { email: otro.adminEmail, nombre: 'Admin Otro', rol: 'recepcion', admin: false, passwordTemporal: PASSWORD });
    expect(e.statusCode).toBe(201);
    expect(await bandera(otro.adminEmail)).toBe(false);
  });
});

describe('POST /miembros/:id/password-temporal', () => {
  test('reinicio por admin: activa bandera, revoca sesiones, la contraseña nueva funciona', async () => {
    const id = await agregarMiembro(app, c, 'reinicio@pw.mx', 'recepcion');
    const vieja = await iniciarSesion(app, 'reinicio@pw.mx');
    expect(await bandera('reinicio@pw.mx')).toBe(false);
    expect((await reiniciar(c.adminToken, id)).statusCode).toBe(204);
    expect(await bandera('reinicio@pw.mx')).toBe(true);
    expect((await pedirToken(app, vieja, c.tenantId)).statusCode).toBe(401);
    expect(await q('select 1 from session where "userId" = $1', [id])).toHaveLength(0);
    const viejaClave = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email: 'reinicio@pw.mx', password: PASSWORD }, headers: { origin: ORIGEN } });
    expect(viejaClave.statusCode).not.toBe(200);
    const nueva = await iniciarSesion(app, 'reinicio@pw.mx', 'temporal-nueva-1');
    const t = await pedirToken(app, nueva, c.tenantId);
    expect(t.statusCode).toBe(403);
    expect(t.json()).toMatchObject({ code: 'PASSWORD_TEMPORAL' });
    expect((await cambiar(nueva, 'temporal-nueva-1', 'clave-definitiva-2')).statusCode).toBe(200);
    expect((await pedirToken(app, nueva, c.tenantId)).statusCode).toBe(200);
  });

  test('reinicio de cuenta compartida con otro consultorio → 409', async () => {
    const otro = await crearConsultorio(app, 'pwtemp-compartida');
    const id = await agregarMiembro(app, c, 'compartida@pw.mx', 'recepcion');
    await agregarMiembro(app, otro, 'compartida@pw.mx', 'recepcion');
    const r = await reiniciar(c.adminToken, id);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'CONFLICTO' });
    expect(await bandera('compartida@pw.mx')).toBe(false);
  });

  test('reinicio de usuario de otro consultorio → 404', async () => {
    const otro = await crearConsultorio(app, 'pwtemp-ajeno');
    const id = await agregarMiembro(app, otro, 'ajeno@pw.mx', 'recepcion');
    const r = await reiniciar(c.adminToken, id);
    expect(r.statusCode).toBe(404);
    expect(await bandera('ajeno@pw.mx')).toBe(false);
  });

  test('recepción no admin no puede reiniciar → 403', async () => {
    await agregarMiembro(app, c, 'recep@pw.mx', 'recepcion');
    const id = await agregarMiembro(app, c, 'victima@pw.mx', 'recepcion');
    const t = (await pedirToken(app, await iniciarSesion(app, 'recep@pw.mx'), c.tenantId)).json<{ token: string }>().token;
    expect((await reiniciar(t, id)).statusCode).toBe(403);
    expect(await bandera('victima@pw.mx')).toBe(false);
  });

  test('valida el cuerpo y el id', async () => {
    const id = await agregarMiembro(app, c, 'valida@pw.mx', 'recepcion');
    expect((await reiniciar(c.adminToken, id, 'corta')).statusCode).toBe(400);
    expect((await reiniciar(c.adminToken, 'no-es-uuid')).statusCode).toBe(400);
  });
});
