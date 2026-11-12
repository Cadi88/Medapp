import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { AppError, createHttpApp, createLogger, platformPlugin, requireAdmin } from '../../src/index.js';
import { startTestJwks, type TestJwks } from '../../src/testing/index.js';

const T = '0194a1b2-0000-7000-8000-000000000001';
const U = '0194a1b2-0000-7000-8000-000000000002';
const claims = { sub: U, tid: T, rol: 'recepcion', admin: false, mfa: false };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const NO_AUTH = { code: 'NO_AUTENTICADO', message: 'No autenticado' };

let jwks: TestJwks;
let app: ReturnType<typeof construir>;
const logLines: string[] = [];
const construir = (sink: Writable) => Fastify({ loggerInstance: createLogger('svc-prueba', sink) });

beforeAll(async () => {
  jwks = await startTestJwks();
  const sink = new Writable({
    write(c, _e, cb) {
      logLines.push(String(c));
      cb();
    },
  });
  app = construir(sink);
  await app.register(platformPlugin, {
    servicio: 'svc-prueba',
    jwksUrl: jwks.url,
    rutasPublicas: ['/publica', '/auth/*'],
  });
  app.get('/privada', async (req) => req.ctx);
  app.get('/solo-admin', { preHandler: requireAdmin() }, async () => ({ ok: true }));
  app.get('/publica', async (req) => ({ traceId: req.ctx.traceId }));
  app.get('/auth/x', async () => ({ ok: true }));
  app.get('/explota', async () => {
    throw new Error('select * from secretos');
  });
  app.get('/conflicto', async () => {
    throw new AppError('CONFLICTO', 'ya existe', 409, { campo: 'slug' });
  });
  app.get('/zod', async () => z.object({ a: z.string() }).parse({}));
  app.post(
    '/body',
    { schema: { body: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } } } },
    async () => ({ ok: true }),
  );
  app.get('/log', async (req) => {
    req.log.info('dentro del handler');
    return { ok: true };
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await jwks.stop();
});

describe('autenticación', () => {
  test('sin token → 401 NO_AUTENTICADO', async () => {
    const r = await app.inject('/privada');
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual(NO_AUTH);
  });
  test.each([
    ['firmado con otra llave', { otraLlave: true }],
    ['expirado', { expiresIn: '-1m' }],
    ['con issuer incorrecto', { issuer: 'otro' }],
  ])('Review Focus 5: token %s → 401', async (_n, o) => {
    const t = await jwks.sign(claims, o);
    const r = await app.inject({ url: '/privada', headers: auth(t) });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual(NO_AUTH);
  });
  test('F4: token sin exp → 401', async () => {
    const t = await jwks.sign(claims, { sinExp: true });
    expect((await app.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(401);
  });
  test('F4: token emitido hace 20 min aunque exp siga en el futuro → 401 (vida máxima 15 min)', async () => {
    const t = await jwks.sign(claims, { iat: Math.floor(Date.now() / 1000) - 20 * 60, expiresIn: '1h' });
    expect((await app.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(401);
  });
  test('F4: token emitido hace 14 min y vigente → 200', async () => {
    const t = await jwks.sign(claims, { iat: Math.floor(Date.now() / 1000) - 14 * 60, expiresIn: '5m' });
    expect((await app.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(200);
  });
  test('Review Focus 5: token sin tid → 401', async () => {
    const t = await jwks.sign({ sub: U, rol: 'medico', admin: true, mfa: true });
    expect((await app.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(401);
  });
  test('claims con rol inválido → 401', async () => {
    const t = await jwks.sign({ ...claims, rol: 'root' });
    expect((await app.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(401);
  });
  test('token sin claim admin o con rol admin (modelo anterior) → 401', async () => {
    const sinAdmin = { sub: U, tid: T, rol: 'recepcion', mfa: false };
    for (const c of [sinAdmin, { ...claims, rol: 'admin' }]) {
      const t = await jwks.sign(c);
      expect((await app.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(401);
    }
  });
  test('token HS256 → 401', async () => {
    const t = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('svc-identidad')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    expect((await app.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(401);
  });
  test('token alg none → 401', async () => {
    const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = `${b({ alg: 'none' })}.${b({ ...claims, iss: 'svc-identidad', exp: 9999999999 })}.`;
    expect((await app.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(401);
  });
  test.each(['Basic dXNlcjpwYXNz', 'Bearer', 'Bearer a b', 'Bearer !!!', 'Token abc'])(
    'Authorization "%s" → 401',
    async (h) => {
      expect((await app.inject({ url: '/privada', headers: { authorization: h } })).statusCode).toBe(401);
    },
  );
  test('token válido expone request.ctx', async () => {
    const r = await app.inject({ url: '/privada', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ tenantId: T, usuarioId: U, rol: 'recepcion', admin: false, mfa: false });
  });
  test('ruta desconocida sin token → 401 (no revela qué existe)', async () => {
    expect((await app.inject('/no-existe')).statusCode).toBe(401);
  });
  test('path traversal desde prefijo público hacia ruta privada exige token', async () => {
    expect((await app.inject('/auth/../privada')).statusCode).toBe(401);
    expect((await app.inject('/auth/%2e%2e/privada')).statusCode).toBe(401);
  });
});

describe('roles', () => {
  test('sin permiso admin → 403 PROHIBIDO', async () => {
    const r = await app.inject({ url: '/solo-admin', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('PROHIBIDO');
  });
  test('con permiso admin → 200', async () => {
    const t = await jwks.sign({ ...claims, admin: true, mfa: true });
    expect((await app.inject({ url: '/solo-admin', headers: auth(t) })).statusCode).toBe(200);
  });
  test('requireAdmin sin ctx autenticado → 401', async () => {
    const a = Fastify();
    await a.register(platformPlugin, { servicio: 's', jwksUrl: jwks.url, rutasPublicas: ['/p'] });
    a.get('/p', { preHandler: requireAdmin() }, async () => 'x');
    expect((await a.inject('/p')).statusCode).toBe(401);
    await a.close();
  });
});

describe('rutas públicas, trace id y errores', () => {
  test('ruta pública no exige token y propaga x-trace-id (también en la respuesta)', async () => {
    const r = await app.inject({ url: '/publica', headers: { 'x-trace-id': 't1' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().traceId).toBe('t1');
    expect(r.headers['x-trace-id']).toBe('t1');
  });
  test('prefijo /auth/* es público', async () => {
    expect((await app.inject('/auth/x')).statusCode).toBe(200);
  });
  test('trace id inválido se reemplaza', async () => {
    const r = await app.inject({ url: '/publica', headers: { 'x-trace-id': 'a b<>' } });
    expect(r.json().traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(r.headers['x-trace-id']).toBe(r.json().traceId);
  });
  test('el trace id también se devuelve en respuestas de error', async () => {
    const r = await app.inject({ url: '/privada', headers: { 'x-trace-id': 'err-1' } });
    expect(r.statusCode).toBe(401);
    expect(r.headers['x-trace-id']).toBe('err-1');
  });
  test('error inesperado → 500 INTERNO sin mensaje interno', async () => {
    const r = await app.inject({ url: '/explota', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ code: 'INTERNO', message: 'Error interno' });
  });
  test('AppError → su status, código y detalles', async () => {
    const r = await app.inject({ url: '/conflicto', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ code: 'CONFLICTO', message: 'ya existe', details: { campo: 'slug' } });
  });
  test('ZodError en handler → 400 VALIDACION', async () => {
    const r = await app.inject({ url: '/zod', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: 'VALIDACION', details: [{ campo: 'a' }] });
  });
  test('validación de esquema Fastify → 400 VALIDACION', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/body',
      headers: auth(await jwks.sign(claims)),
      payload: { n: 'x' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: 'VALIDACION', details: [{ campo: 'n' }] });
  });
  test('JSON inválido → 400 VALIDACION', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/body',
      headers: { ...auth(await jwks.sign(claims)), 'content-type': 'application/json' },
      payload: '{',
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('VALIDACION');
  });
  test('ruta desconocida autenticada → 404 NO_ENCONTRADO', async () => {
    const r = await app.inject({ url: '/no-existe', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ code: 'NO_ENCONTRADO', message: 'Recurso no encontrado' });
  });
});

describe('logs', () => {
  test('los logs incluyen servicio, tenant_id y trace_id; nunca el token', async () => {
    logLines.length = 0;
    const token = await jwks.sign(claims);
    await app.inject({ url: '/log', headers: { ...auth(token), 'x-trace-id': 'log-1' } });
    const l = logLines
      .map((x) => JSON.parse(x) as Record<string, unknown>)
      .find((x) => x.msg === 'dentro del handler');
    expect(l).toMatchObject({ servicio: 'svc-prueba', tenant_id: T, trace_id: 'log-1' });
    const c = logLines.map((x) => JSON.parse(x) as Record<string, unknown>).find((x) => x.msg === 'request completed');
    expect(c).toMatchObject({ servicio: 'svc-prueba', tenant_id: T, trace_id: 'log-1' });
    expect(logLines.join('')).not.toContain(token);
  });
  test('el 500 se registra con stack', async () => {
    logLines.length = 0;
    await app.inject({ url: '/explota', headers: auth(await jwks.sign(claims)) });
    const l = logLines
      .map((x) => JSON.parse(x) as { level: number; err?: { stack?: string } })
      .find((x) => x.level === 50);
    expect(l?.err?.stack).toContain('secretos');
  });
});

describe('registro', () => {
  test('sin jwksUrl ni verificador lanza', async () => {
    const a = Fastify();
    await expect(a.register(platformPlugin, { servicio: 's' }).ready()).rejects.toThrow(/jwksUrl|verificador/);
  });
  test('verificador tiene prioridad sobre jwksUrl', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k', alg: 'EdDSA' };
    const a = Fastify();
    await a.register(platformPlugin, {
      servicio: 's',
      jwksUrl: 'http://127.0.0.1:1/nada',
      verificador: createLocalJWKSet({ keys: [jwk] }),
    });
    a.get('/privada', async (req) => req.ctx);
    const t = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k' })
      .setIssuer('svc-identidad')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    expect((await a.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(200);
    await a.close();
  });
});

describe('createHttpApp', () => {
  test('(a) ruta/plugin hijo posterior que lanza Error → 500 uniforme sin filtrar', async () => {
    const a = await createHttpApp({ servicio: 's', plugin: { jwksUrl: jwks.url } });
    await a.register(async (child) => {
      child.get('/hijo', async () => {
        throw new Error('secreto interno');
      });
    });
    a.get('/raiz', async () => {
      throw new Error('secreto interno');
    });
    const h = auth(await jwks.sign(claims));
    for (const url of ['/hijo', '/raiz']) {
      const r = await a.inject({ url, headers: h });
      expect(r.statusCode).toBe(500);
      expect(r.json()).toEqual({ code: 'INTERNO', message: 'Error interno' });
      expect(r.body).not.toContain('secreto');
    }
    const nf = await a.inject({ url: '/nada', headers: h });
    expect(nf.json()).toEqual({ code: 'NO_ENCONTRADO', message: 'Recurso no encontrado' });
    await a.close();
  });
  test('(b) URL malformada → 400 uniforme con x-trace-id', async () => {
    const a = await createHttpApp({ servicio: 's', plugin: { jwksUrl: jwks.url } });
    const r = await a.inject({ url: '/%zz', headers: { 'x-trace-id': 'bad-1' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ code: 'VALIDACION', message: 'Solicitud inválida' });
    expect(r.headers['x-trace-id']).toBe('bad-1');
    const r2 = await a.inject({ url: '/%zz' });
    expect(r2.headers['x-trace-id']).toMatch(/^[a-f0-9]{32}$/);
    await a.close();
  });
  test('(c) createHttpApp es el camino seguro: el plugin se registra primero y acepta opciones de Fastify', async () => {
    const a = await createHttpApp({ servicio: 's', plugin: { jwksUrl: jwks.url, rutasPublicas: ['/p'] }, fastify: { bodyLimit: 10 } });
    a.get('/p', async (req) => ({ t: req.ctx.traceId }));
    expect((await a.inject('/p')).statusCode).toBe(200);
    const big = await a.inject({ method: 'POST', url: '/p', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ x: 'y'.repeat(50) }) });
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe('VALIDACION');
    await a.close();
  });
});
