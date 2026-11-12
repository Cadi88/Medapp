import { createLocalJWKSet, jwtVerify } from 'jose';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  PASSWORD,
  activarTotpEIniciarSesion,
  activarTotp,
  iniciarSesionConTotp,
  agregarMiembro,
  conToken,
  crearConsultorio,
  iniciarSesion,
  pedirToken,
  prepararBase,
  registro,
  servidor,
  type Consultorio,
  type Entorno,
} from './helpers.js';
import { iniciarSesionSoloPassword } from './helpers-mfa.js';

let env: Entorno;
let app: FastifyInstance;
let t1: Consultorio;
let t2: Consultorio;
let recepcionId: string;

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
  t1 = await crearConsultorio(app, 'sesion-uno');
  t2 = await crearConsultorio(app, 'sesion-dos');
  recepcionId = await agregarMiembro(app, t1, 'recepcion@sesion-uno.mx', 'recepcion');
  await agregarMiembro(app, t1, 'medico@sesion-uno.mx', 'medico');
});
afterAll(async () => {
  await app.close();
  await env.stop();
});

describe('GET /.well-known/jwks.json', () => {
  test('es pública, publica solo la llave pública y el kid de las firmas', async () => {
    const r = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    expect(r.statusCode).toBe(200);
    const { keys } = r.json<{ keys: Record<string, unknown>[] }>();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: 'identidad-test', alg: 'EdDSA', use: 'sig' });
    expect(keys[0]).not.toHaveProperty('d');
  });
});

describe('GET /tenants/mios', () => {
  test('sin sesión → 401 NO_AUTENTICADO', async () => {
    const r = await app.inject({ method: 'GET', url: '/tenants/mios' });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('NO_AUTENTICADO');
  });

  test('cookie inválida → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/tenants/mios', headers: { cookie: 'better-auth.session_token=basura' } });
    expect(r.statusCode).toBe(401);
  });

  test('lista solo los consultorios de la sesión, con su rol', async () => {
    const cookie = await iniciarSesion(app, 'recepcion@sesion-uno.mx');
    const r = await app.inject({ method: 'GET', url: '/tenants/mios', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([{ tenantId: t1.tenantId, nombre: 'Consultorio sesion-uno', slug: 'sesion-uno', rol: 'recepcion', admin: false }]);
  });

  test('un usuario en dos consultorios los ve ambos', async () => {
    await agregarMiembro(app, t1, 'dual@sesion-uno.mx', 'recepcion');
    await agregarMiembro(app, t2, 'dual@sesion-uno.mx', 'medico');
    const cookie = await iniciarSesion(app, 'dual@sesion-uno.mx');
    const r = await app.inject({ method: 'GET', url: '/tenants/mios', headers: { cookie } });
    expect(r.json().map((x: { slug: string; rol: string }) => [x.slug, x.rol]).sort()).toEqual([
      ['sesion-dos', 'medico'],
      ['sesion-uno', 'recepcion'],
    ]);
  });
});

describe('POST /sesion/tenant', () => {
  test('sin sesión → 401 NO_AUTENTICADO', async () => {
    const r = await app.inject({ method: 'POST', url: '/sesion/tenant', payload: { tenantId: t1.tenantId } });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('NO_AUTENTICADO');
  });

  test('un token de tenant no sustituye a la sesión', async () => {
    const r = await app.inject({ method: 'POST', url: '/sesion/tenant', payload: { tenantId: t1.tenantId }, headers: conToken(t1.adminToken) });
    expect(r.statusCode).toBe(401);
  });

  test('fundador sin MFA → 403 MFA_REQUERIDA', async () => {
    await app.inject({ method: 'POST', url: '/registro', payload: registro('sin-mfa') });
    const cookie = await iniciarSesion(app, 'sin-mfa@ejemplo.mx');
    const tenantId = (await app.inject({ method: 'GET', url: '/tenants/mios', headers: { cookie } })).json()[0].tenantId;
    const r = await pedirToken(app, cookie, tenantId);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('MFA_REQUERIDA');
    expect(JSON.stringify(r.json())).not.toMatch(/token/i);
  });

  test('recepción con permiso admin sin MFA → 403 MFA_REQUERIDA; con MFA obtiene token admin', async () => {
    const email = 'recep-admin@sesion-uno.mx';
    await agregarMiembro(app, t1, email, 'recepcion', true);
    const cookie = await iniciarSesion(app, email);
    const r = await pedirToken(app, cookie, t1.tenantId);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('MFA_REQUERIDA');
    const jwks = createLocalJWKSet((await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).json());
    const { cookie: conMfa } = await activarTotpEIniciarSesion(app, email);
    const ok = await pedirToken(app, conMfa, t1.tenantId);
    expect(ok.statusCode).toBe(200);
    const { payload } = await jwtVerify(ok.json().token, jwks, { issuer: 'svc-identidad' });
    expect(payload).toMatchObject({ rol: 'recepcion', admin: true, mfa: true });
  });

  test('médico sin MFA → 403 MFA_REQUERIDA', async () => {
    const cookie = await iniciarSesion(app, 'medico@sesion-uno.mx');
    const r = await pedirToken(app, cookie, t1.tenantId);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('MFA_REQUERIDA');
  });

  test('token incluye admin y rol de trabajo (claims correctos y exp 15 min)', async () => {
    const jwksRes = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    const jwks = createLocalJWKSet(jwksRes.json());
    const cookie = await iniciarSesionConTotp(app, t1.adminEmail, t1.adminSecret);
    const r = await pedirToken(app, cookie, t1.tenantId);
    expect(r.statusCode).toBe(200);
    const { token } = r.json<{ token: string }>();
    const { payload, protectedHeader } = await jwtVerify(token, jwks, { issuer: 'svc-identidad', algorithms: ['EdDSA'] });
    expect(protectedHeader.kid).toBe('identidad-test');
    expect(payload).toMatchObject({ sub: t1.adminId, tid: t1.tenantId, rol: 'medico', admin: true, mfa: true });
    expect(payload.exp! - payload.iat!).toBe(900);
  });

  test('el token emitido es aceptado por las rutas protegidas del servicio', async () => {
    const r = await app.inject({ method: 'PUT', url: '/datos-fiscales', payload: {}, headers: conToken(t1.adminToken) });
    expect(r.statusCode).toBe(400); // pasó autenticación y rol; falla la validación del cuerpo
  });

  test('recepción sin MFA sí obtiene token (mfa=false)', async () => {
    const jwks = createLocalJWKSet((await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).json());
    const cookie = await iniciarSesion(app, 'recepcion@sesion-uno.mx');
    const r = await pedirToken(app, cookie, t1.tenantId);
    expect(r.statusCode).toBe(200);
    const { payload } = await jwtVerify(r.json().token, jwks, { issuer: 'svc-identidad' });
    expect(payload).toMatchObject({ sub: recepcionId, tid: t1.tenantId, rol: 'recepcion', admin: false, mfa: false });
  });

  test('el rol del token es el de la membresía en ese tenant', async () => {
    const jwks = createLocalJWKSet((await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).json());
    const cookie = await iniciarSesion(app, 'dual@sesion-uno.mx');
    // En t2 esta persona es médico: requiere MFA.
    const r = await pedirToken(app, cookie, t2.tenantId);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('MFA_REQUERIDA');
    const { cookie: conMfa } = await activarTotpEIniciarSesion(app, 'dual@sesion-uno.mx');
    const ok = await pedirToken(app, conMfa, t2.tenantId);
    const { payload } = await jwtVerify(ok.json().token, jwks, { issuer: 'svc-identidad' });
    expect(payload).toMatchObject({ tid: t2.tenantId, rol: 'medico', admin: false, mfa: true });
  });

  test('usuario de otro consultorio → 403 PROHIBIDO', async () => {
    const cookie = await iniciarSesion(app, 'medico@sesion-uno.mx');
    const r = await pedirToken(app, cookie, t2.tenantId);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('PROHIBIDO');
  });

  test('tenant inexistente → 403 PROHIBIDO (no revela si existe)', async () => {
    const cookie = await iniciarSesion(app, 'medico@sesion-uno.mx');
    const r = await pedirToken(app, cookie, '0190aaaa-0000-7000-8000-000000000099');
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('PROHIBIDO');
  });

  test.each([['no-uuid'], [123], [undefined]])('tenantId %j → 400 VALIDACION', async (tenantId) => {
    const cookie = await iniciarSesion(app, 'recepcion@sesion-uno.mx');
    const r = await pedirToken(app, cookie, tenantId);
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('VALIDACION');
  });

  test('Review Focus 1: miembro removido no obtiene token nuevo', async () => {
    const email = 'removible@sesion-uno.mx';
    const id = await agregarMiembro(app, t1, email, 'recepcion');
    const cookie = await iniciarSesion(app, email, PASSWORD);
    expect((await pedirToken(app, cookie, t1.tenantId)).statusCode).toBe(200);
    const del = await app.inject({ method: 'DELETE', url: `/miembros/${id}`, headers: conToken(t1.adminToken) });
    expect(del.statusCode).toBe(204);
    const r = await pedirToken(app, cookie, t1.tenantId);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('PROHIBIDO');
  });

  test('no se deja rastro de secretos en la respuesta de error', async () => {
    const cookie = await iniciarSesion(app, 'medico@sesion-uno.mx');
    const r = await pedirToken(app, cookie, t1.tenantId);
    expect(r.body).not.toMatch(/secret|backup|password/i);
  });
});

describe('sesiones y alta de MFA', () => {
  const sesionTenant = (cookie: string, tenantId: string) => pedirToken(app, cookie, tenantId);

  test('una sesión solo-contraseña previa al alta de MFA queda revocada al activarse; la nueva sigue', async () => {
    const reg = await app.inject({ method: 'POST', url: '/registro', payload: registro('mfa-revoca') });
    const { tenantId } = reg.json<{ tenantId: string }>();
    const a = await iniciarSesion(app, 'mfa-revoca@ejemplo.mx'); // dispositivo A, solo contraseña
    const b = await iniciarSesion(app, 'mfa-revoca@ejemplo.mx'); // dispositivo B
    expect((await sesionTenant(a, tenantId)).statusCode).toBe(403); // antes del alta: admin sin MFA
    const { secret, cookie: bNueva } = await activarTotp(app, b);
    const rA = await sesionTenant(a, tenantId);
    expect(rA.statusCode).toBe(401);
    expect(rA.json().code).toBe('NO_AUTENTICADO');
    expect((await app.inject({ method: 'GET', url: '/tenants/mios', headers: { cookie: a } })).statusCode).toBe(401);
    const rB = await sesionTenant(bNueva, tenantId);
    expect(rB.statusCode).toBe(200);
    const jwks = createLocalJWKSet((await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).json());
    expect((await jwtVerify(rB.json().token, jwks, { issuer: 'svc-identidad' })).payload).toMatchObject({ rol: 'medico', admin: true, mfa: true });
    // Un sign-in posterior con TOTP NO revoca las demás sesiones ya verificadas.
    const c2 = await iniciarSesionConTotp(app, 'mfa-revoca@ejemplo.mx', secret);
    expect((await sesionTenant(c2, tenantId)).statusCode).toBe(200);
    expect((await sesionTenant(bNueva, tenantId)).statusCode).toBe(200);
  });

  test('regresión: sign-in solo con contraseña de un usuario con 2FA activo no obtiene token', async () => {
    const cookie = await iniciarSesionSoloPassword(app, t1.adminEmail);
    expect(cookie).not.toContain('session_token');
    const r = await sesionTenant(cookie, t1.tenantId);
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('NO_AUTENTICADO');
  });
});
