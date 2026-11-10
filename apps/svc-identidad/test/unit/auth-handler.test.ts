import { createHttpApp } from '@consultorio/platform';
import { createLocalJWKSet } from 'jose';
import { afterEach, describe, expect, test } from 'vitest';
import { authRoutes } from '../../src/routes/auth.js';

let app: Awaited<ReturnType<typeof createHttpApp>> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function montar(handler: (r: Request) => Promise<Response>) {
  process.env.LOG_LEVEL = 'silent';
  app = await createHttpApp({
    servicio: 'svc-prueba',
    plugin: { verificador: createLocalJWKSet({ keys: [] }), rutasPublicas: ['/auth/*'] },
  });
  await app.register(authRoutes, { auth: { handler } as never });
  await app.ready();
  return app;
}

describe('authRoutes (puente Fastify a Better Auth)', () => {
  test('reenvía método, ruta, query, cabeceras y cuerpo JSON', async () => {
    let visto: { url: string; method: string; ct: string | null; body: string } | undefined;
    const a = await montar(async (r) => {
      visto = { url: r.url, method: r.method, ct: r.headers.get('content-type'), body: await r.text() };
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const res = await a.inject({ method: 'POST', url: '/auth/sign-in/email?x=1', payload: { email: 'a@b.mx' }, headers: { host: 'idp.local' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(visto).toMatchObject({ method: 'POST', ct: 'application/json' });
    expect(visto?.url).toBe('http://idp.local/auth/sign-in/email?x=1');
    expect(JSON.parse(visto?.body ?? '')).toEqual({ email: 'a@b.mx' });
  });

  test('GET sin cuerpo; preserva status y varias cabeceras Set-Cookie', async () => {
    const a = await montar(async (r) => {
      expect(r.method).toBe('GET');
      expect(await r.text()).toBe('');
      const h = new Headers({ 'content-type': 'application/json' });
      h.append('set-cookie', 'a=1; Path=/; HttpOnly');
      h.append('set-cookie', 'b=2; Path=/; HttpOnly');
      return new Response('{"user":null}', { status: 201, headers: h });
    });
    const res = await a.inject({ method: 'GET', url: '/auth/get-session' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['set-cookie']).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; HttpOnly']);
  });

  test('respuesta sin cuerpo (302) se envía vacía', async () => {
    const a = await montar(async () => new Response(null, { status: 302, headers: { location: '/otra' } }));
    const res = await a.inject({ method: 'GET', url: '/auth/callback' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/otra');
    expect(res.body).toBe('');
  });

  test('un fallo del manejador de Better Auth sale con el formato único (500 INTERNO)', async () => {
    const a = await montar(async () => {
      throw new Error('detalle interno');
    });
    const res = await a.inject({ method: 'GET', url: '/auth/lo-que-sea' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNO', message: 'Error interno' });
  });
});

describe('authRoutes: alta directa bloqueada', () => {
  test.each(['/auth/sign-up/email', '/auth/sign-up/otro', '/auth/sign-up'])('%s → 404 sin llegar a Better Auth', async (url) => {
    let llamado = false;
    const a = await montar(async () => {
      llamado = true;
      return new Response('{}');
    });
    const res = await a.inject({ method: 'POST', url, payload: { email: 'a@b.mx' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NO_ENCONTRADO');
    expect(llamado).toBe(false);
  });
});
