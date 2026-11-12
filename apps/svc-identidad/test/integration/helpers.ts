import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NatsConnection } from '@nats-io/transport-node';
import { createPool, runMigrations } from '@consultorio/platform';
import { startPostgres, type TestPostgres } from '@consultorio/platform/testing';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { exportJWK, generateKeyPair, type JWK } from 'jose';
import { generate } from 'otplib';
import type pg from 'pg';
import { buildServer } from '../../src/server.js';

export const MIGRACIONES = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface Entorno {
  pgh: TestPostgres;
  migrator: pg.Pool;
  appPool: pg.Pool;
  stop(): Promise<void>;
}

/**
 * Las migraciones llevan el rol de producción `identidad_app`; en pruebas el rol de aplicación es
 * `test_app`, así que se aplica una copia temporal con el nombre sustituido.
 */
export async function prepararBase(): Promise<Entorno> {
  const pgh = await startPostgres();
  const dir = mkdtempSync(join(tmpdir(), 'identidad-mig-'));
  try {
    cpSync(MIGRACIONES, dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      writeFileSync(p, readFileSync(p, 'utf8').replaceAll('"identidad_app"', '"test_app"'));
    }
    await runMigrations(pgh.migratorUrl, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const migrator = createPool(pgh.migratorUrl);
  const appPool = createPool(pgh.appUrl);
  return {
    pgh,
    migrator,
    appPool,
    stop: async () => {
      await migrator.end();
      await appPool.end();
      await pgh.stop();
    },
  };
}

export async function llavePrivada(): Promise<JWK> {
  const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
  return { ...(await exportJWK(privateKey)), kid: 'identidad-test' };
}

export async function servidor(env: Entorno, nc?: NatsConnection): Promise<FastifyInstance> {
  const app = await buildServer({
    pool: env.appPool,
    ...(nc ? { nc } : {}),
    jwtPrivateJwk: await llavePrivada(),
    betterAuth: { secret: 'secreto-de-pruebas-'.repeat(3), baseURL: 'http://localhost:3000' },
  });
  await app.ready();
  return app;
}

export const registro = (slug: string, email = `${slug}@ejemplo.mx`, extra: Record<string, unknown> = {}) => ({
  nombreConsultorio: `Consultorio ${slug}`,
  slug,
  zonaHoraria: 'America/Mexico_City',
  esMedico: true,
  admin: { nombre: 'Admin Prueba', email, password: 'clave-de-prueba-123' },
  ...extra,
});

export async function limpiar(migrator: pg.Pool): Promise<void> {
  await migrator.query('TRUNCATE outbox, perfil_medico, datos_fiscales, membresia, tenant, "twoFactor", session, account, verification, "user" CASCADE');
}

// ---------------------------------------------------------------------------
// Sesión, MFA (TOTP real de Better Auth) y tokens de tenant.
// Task 10 (E2E) puede replicar este flujo: enable -> verify-totp -> sign-in -> verify-totp.
// ---------------------------------------------------------------------------
export const ORIGEN = 'http://localhost:3000';
export const PASSWORD = 'clave-de-prueba-123';

/** Acumula cookies de las respuestas `set-cookie` (descarta las expiradas/vacías). */
export function mezclarCookies(actual: string, res: LightMyRequestResponse): string {
  const jar = new Map<string, string>();
  for (const par of actual.split('; ').filter(Boolean)) {
    const i = par.indexOf('=');
    jar.set(par.slice(0, i), par.slice(i + 1));
  }
  const crudo = res.headers['set-cookie'];
  const lista = crudo === undefined ? [] : Array.isArray(crudo) ? crudo : [crudo];
  for (const c of lista) {
    const [par = ''] = c.split(';');
    const i = par.indexOf('=');
    const nombre = par.slice(0, i);
    const valor = par.slice(i + 1);
    if (valor === '' || /max-age=0/i.test(c)) jar.delete(nombre);
    else jar.set(nombre, valor);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

const jsonAuth = (app: FastifyInstance, url: string, payload: object, cookie = '') =>
  app.inject({ method: 'POST', url, payload, headers: { origin: ORIGEN, ...(cookie ? { cookie } : {}) } });

/** Sign-in de un usuario sin 2FA activo. Devuelve el header `cookie` de la sesión. */
export async function iniciarSesion(app: FastifyInstance, email: string, password = PASSWORD): Promise<string> {
  const r = await jsonAuth(app, '/auth/sign-in/email', { email, password });
  if (r.statusCode !== 200) throw new Error(`sign-in falló: ${r.statusCode}`);
  const cookie = mezclarCookies('', r);
  if (!cookie.includes('session_token')) throw new Error('sign-in no abrió sesión (¿2FA activo?)');
  return cookie;
}

export async function codigoTotp(secret: string): Promise<string> {
  return generate({ secret, strategy: 'totp' });
}

/** Secreto base32 del `totpURI` que devuelve /two-factor/enable. */
export function secretoDeUri(totpURI: string): string {
  const s = new URL(totpURI).searchParams.get('secret');
  if (!s) throw new Error('totpURI sin secreto');
  return s;
}

/** Activa TOTP para el usuario de `cookie` (enable + verify con código real). Devuelve el secreto y la cookie de la sesión que reemplaza a la actual. */
export async function activarTotp(app: FastifyInstance, cookie: string, password = PASSWORD): Promise<{ secret: string; cookie: string }> {
  const en = await jsonAuth(app, '/auth/two-factor/enable', { password }, cookie);
  if (en.statusCode !== 200) throw new Error(`two-factor/enable falló: ${en.statusCode}`);
  const secret = secretoDeUri(en.json<{ totpURI: string }>().totpURI);
  const v = await jsonAuth(app, '/auth/two-factor/verify-totp', { code: await codigoTotp(secret) }, cookie);
  if (v.statusCode !== 200) throw new Error(`two-factor/verify-totp falló: ${v.statusCode}`);
  return { secret, cookie: mezclarCookies(cookie, v) };
}

/** Sign-in de un usuario con TOTP activo: credenciales y luego código. Devuelve cookie de sesión. */
export async function iniciarSesionConTotp(app: FastifyInstance, email: string, secret: string, password = PASSWORD): Promise<string> {
  const r = await jsonAuth(app, '/auth/sign-in/email', { email, password });
  if (r.statusCode !== 200 || !r.json<{ twoFactorRedirect?: boolean }>().twoFactorRedirect) throw new Error('se esperaba twoFactorRedirect');
  let cookie = mezclarCookies('', r);
  const v = await jsonAuth(app, '/auth/two-factor/verify-totp', { code: await codigoTotp(secret) }, cookie);
  if (v.statusCode !== 200) throw new Error(`verify-totp tras sign-in falló: ${v.statusCode}`);
  cookie = mezclarCookies(cookie, v);
  if (!cookie.includes('session_token')) throw new Error('verify-totp no abrió sesión');
  return cookie;
}

/** Activa TOTP y devuelve la sesión resultante (con 2FA ya satisfecho) junto con el secreto. */
export async function activarTotpEIniciarSesion(app: FastifyInstance, email: string, password = PASSWORD): Promise<{ cookie: string; secret: string }> {
  const { secret } = await activarTotp(app, await iniciarSesion(app, email, password), password);
  return { cookie: await iniciarSesionConTotp(app, email, secret, password), secret };
}

export const pedirToken = (app: FastifyInstance, cookie: string, tenantId: unknown) =>
  app.inject({ method: 'POST', url: '/sesion/tenant', payload: { tenantId } as object, headers: { cookie } });

/** Token de tenant para el usuario (activa MFA si hace falta). */
export async function tokenDe(app: FastifyInstance, email: string, tenantId: string, opciones: { mfa: boolean } = { mfa: true }): Promise<string> {
  const cookie = opciones.mfa ? (await activarTotpEIniciarSesion(app, email)).cookie : await iniciarSesion(app, email);
  const r = await pedirToken(app, cookie, tenantId);
  if (r.statusCode !== 200) throw new Error(`token falló: ${r.statusCode} ${r.body}`);
  return r.json<{ token: string }>().token;
}

export const conToken = (token: string) => ({ authorization: `Bearer ${token}` });

export interface Consultorio {
  tenantId: string;
  adminId: string;
  adminEmail: string;
  adminToken: string;
  adminSecret: string;
}

/** Registra un consultorio y deja al admin listo con TOTP activo y token de tenant. */
export async function crearConsultorio(app: FastifyInstance, slug: string): Promise<Consultorio> {
  const adminEmail = `admin-${slug}@ejemplo.mx`;
  const r = await app.inject({ method: 'POST', url: '/registro', payload: registro(slug, adminEmail) });
  if (r.statusCode !== 201) throw new Error(`registro falló: ${r.statusCode}`);
  const { tenantId, usuarioId } = r.json<{ tenantId: string; usuarioId: string }>();
  const { cookie, secret } = await activarTotpEIniciarSesion(app, adminEmail);
  const t = await pedirToken(app, cookie, tenantId);
  if (t.statusCode !== 200) throw new Error(`token falló: ${t.statusCode} ${t.body}`);
  return { tenantId, adminId: usuarioId, adminEmail, adminToken: t.json<{ token: string }>().token, adminSecret: secret };
}

export const invitarMiembro = (app: FastifyInstance, adminToken: string, cuerpo: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/miembros', payload: cuerpo, headers: conToken(adminToken) });

/** Primer ingreso de un miembro invitado: cambia la contraseña temporal (por la misma PASSWORD) y baja la bandera. */
export async function cambiarPasswordTemporal(app: FastifyInstance, email: string, nueva = PASSWORD, actual = PASSWORD): Promise<void> {
  const cookie = await iniciarSesion(app, email, actual);
  const r = await jsonAuth(app, '/auth/change-password', { currentPassword: actual, newPassword: nueva }, cookie);
  if (r.statusCode !== 200) throw new Error(`change-password falló: ${r.statusCode} ${r.body}`);
}

/** Invita a un miembro (password temporal = PASSWORD), le quita la bandera de contraseña temporal y devuelve su id. `admin` concede además el permiso de administración. */
export async function agregarMiembro(
  app: FastifyInstance,
  c: Consultorio,
  email: string,
  rol: 'medico' | 'recepcion',
  admin = false,
): Promise<string> {
  const r = await invitarMiembro(app, c.adminToken, { email, nombre: `Miembro ${rol}`, rol, admin, passwordTemporal: PASSWORD });
  if (r.statusCode !== 201) throw new Error(`invitación falló: ${r.statusCode} ${r.body}`);
  await cambiarPasswordTemporal(app, email);
  return r.json<{ usuarioId: string }>().usuarioId;
}
