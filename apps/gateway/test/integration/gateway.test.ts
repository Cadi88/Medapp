import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startTestJwks, type TestJwks } from '@consultorio/platform/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildGateway } from '../../src/server.js';

const claims = { sub: '0198f2a0-0000-7000-8000-000000000001', tid: '0198f2a0-0000-7000-8000-0000000000aa', rol: 'medico', admin: true, mfa: true };

interface Destino {
  url: string;
  stop(): Promise<void>;
}

/** Destino simulado: devuelve en JSON lo que recibió; rutas especiales para cookies y 4xx. */
async function iniciarDestino(): Promise<Destino> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      recibidos++;
      const url = req.url ?? '';
      if (url.startsWith('/dos-cookies')) {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['a=1; Path=/; HttpOnly', 'b=2; Path=/'] });
        res.end('{}');
        return;
      }
      if (url.startsWith('/conflicto')) {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 'CONFLICTO', message: 'Ya existe', details: [{ campo: 'slug' }] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

let jwks: TestJwks;
let identidad: Destino;
let auditoria: Destino;
let agenda: Destino;
let gw: FastifyInstance;
const abiertos: FastifyInstance[] = [];
let recibidos = 0;

const nuevo = async (extra: Partial<Parameters<typeof buildGateway>[0]> = {}): Promise<FastifyInstance> => {
  const app = await buildGateway({
    jwksUrl: jwks.url,
    destinos: { identidad: identidad.url, auditoria: auditoria.url, agenda: agenda.url },
    ...extra,
  });
  abiertos.push(app);
  return app;
};
/**
 * Petición HTTP real con la ruta tal cual (sin normalizar): `inject` resuelve los segmentos `..` antes de
 * llegar a Fastify, un cliente real no.
 */
async function crudo(app: FastifyInstance, method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown> }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}
const auth = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });
const registroReq = { method: 'POST' as const, url: '/api/identidad/registro', payload: {} };

beforeAll(async () => {
  jwks = await startTestJwks();
  identidad = await iniciarDestino();
  auditoria = await iniciarDestino();
  agenda = await iniciarDestino();
  gw = await nuevo();
});
afterAll(async () => {
  for (const a of abiertos) await a.close();
  await identidad.stop();
  await auditoria.stop();
  await agenda.stop();
  await jwks.stop();
});

describe('autenticación en el gateway', () => {
  test('ruta protegida sin token → 401', async () => {
    const r = await gw.inject({ url: '/api/auditoria/eventos' });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('NO_AUTENTICADO');
  });

  test('agenda: sin token → 401 y con token llega a agenda con método y cuerpo', async () => {
    expect((await gw.inject({ method: 'POST', url: '/api/agenda/citas', payload: {} })).statusCode).toBe(401);
    const r = await gw.inject({ method: 'PATCH', url: '/api/agenda/citas/abc', headers: auth(await jwks.sign(claims)), payload: { version: 1 } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ method: 'PATCH', url: '/citas/abc', body: '{"version":1}' });
  });

  test('token de otra llave, expirado o sin tid → 401', async () => {
    for (const t of [
      await jwks.sign(claims, { otraLlave: true }),
      await jwks.sign(claims, { expiresIn: '-1m' }),
      await jwks.sign({ sub: claims.sub, rol: 'medico', admin: true, mfa: true }),
    ]) {
      const r = await gw.inject({ url: '/api/auditoria/eventos', headers: auth(t) });
      expect(r.statusCode).toBe(401);
      expect(r.json().code).toBe('NO_AUTENTICADO');
    }
  });

  test('token válido llega a auditoria con Authorization y x-trace-id', async () => {
    const token = await jwks.sign(claims);
    const r = await gw.inject({ url: '/api/auditoria/eventos', headers: auth(token) });
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-trace-id']).toBeTruthy();
    const j = r.json();
    expect(j.headers.authorization).toBe(`Bearer ${token}`);
    expect(j.headers['x-trace-id']).toBe(r.headers['x-trace-id']);
  });

  test('F4: la cookie del cliente no llega a auditoria', async () => {
    const r = await gw.inject({ url: '/api/auditoria/eventos', headers: { ...auth(await jwks.sign(claims)), cookie: 'better-auth.session_token=s' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().headers.cookie).toBeUndefined();
  });

  test('ruta protegida de identidad con token llega a identidad', async () => {
    const r = await gw.inject({ url: '/api/identidad/miembros', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(200);
    expect(r.json().url).toBe('/miembros');
  });

  test('ruta desconocida sin token → 401; con token → 404 uniforme', async () => {
    expect((await gw.inject({ url: '/nada' })).statusCode).toBe(401);
    const r = await gw.inject({ url: '/nada', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe('NO_ENCONTRADO');
  });
});

describe('rutas públicas y de sesión', () => {
  test('registro es público y reescribe el prefijo', async () => {
    const r = await gw.inject({ ...registroReq, payload: { slug: 'x' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ method: 'POST', url: '/registro', body: '{"slug":"x"}' });
    expect(r.json().headers['content-type']).toMatch(/application\/json/);
  });

  test('auth/* y jwks son públicos', async () => {
    const a = await gw.inject({ method: 'POST', url: '/api/identidad/auth/sign-in/email', payload: {} });
    expect(a.statusCode).toBe(200);
    expect(a.json().url).toBe('/auth/sign-in/email');
    const j = await gw.inject({ url: '/api/identidad/.well-known/jwks.json' });
    expect(j.statusCode).toBe(200);
    expect(j.json().url).toBe('/.well-known/jwks.json');
  });

  test('rutas de sesión son públicas y reenvían la cookie', async () => {
    const a = await gw.inject({ url: '/api/identidad/tenants/mios', headers: { cookie: 'sid=abc' } });
    expect(a.statusCode).toBe(200);
    expect(a.json().headers.cookie).toBe('sid=abc');
    const b = await gw.inject({ method: 'POST', url: '/api/identidad/sesion/tenant', headers: { cookie: 'sid=abc' }, payload: {} });
    expect(b.statusCode).toBe(200);
    expect(b.json().url).toBe('/sesion/tenant');
  });

  test('método no listado en una ruta pública exige token', async () => {
    expect((await gw.inject({ url: '/api/identidad/registro' })).statusCode).toBe(401);
    expect((await gw.inject({ method: 'POST', url: '/api/identidad/tenants/mios', payload: {} })).statusCode).toBe(401);
  });

  test('intento de path traversal desde una ruta pública se rechaza (400) antes de clasificar', async () => {
    for (const path of [
      '/api/identidad/registro/../miembros',
      '/api/identidad/auth/../miembros',
      '/api/identidad/auth/%2e%2e/miembros',
      '/api/identidad/auth/..%2fmiembros',
    ]) {
      const r = await crudo(gw, 'POST', path);
      expect(r.status, path).toBe(400);
    }
  });
});

describe('cabeceras, query y errores del destino', () => {
  test('conserva el query string', async () => {
    const r = await gw.inject({ url: '/api/auditoria/eventos?limite=5&x=a%20b', headers: auth(await jwks.sign(claims)) });
    expect(r.json().url).toBe('/eventos?limite=5&x=a%20b');
  });

  test('x-trace-id válido del cliente se conserva; inválido se reemplaza', async () => {
    const token = await jwks.sign(claims);
    const ok = await gw.inject({ url: '/api/auditoria/eventos', headers: { ...auth(token), 'x-trace-id': 'mi-trace-1' } });
    expect(ok.headers['x-trace-id']).toBe('mi-trace-1');
    expect(ok.json().headers['x-trace-id']).toBe('mi-trace-1');
    const mal = await gw.inject({ url: '/api/auditoria/eventos', headers: { ...auth(token), 'x-trace-id': 'a b;<script>' } });
    expect(mal.headers['x-trace-id']).not.toContain('<');
    expect(mal.json().headers['x-trace-id']).toBe(mal.headers['x-trace-id']);
  });

  test('X-Forwarded-For/Proto se fijan desde el gateway y no se confía en los del cliente', async () => {
    const r = await gw.inject({
      url: '/api/identidad/tenants/mios',
      remoteAddress: '198.51.100.7',
      headers: { 'x-forwarded-for': '1.2.3.4', 'x-forwarded-proto': 'https' },
    });
    expect(r.json().headers['x-forwarded-for']).toBe('198.51.100.7');
    expect(r.json().headers['x-forwarded-proto']).toBe('http');
  });

  test('Set-Cookie múltiple pasa intacto', async () => {
    const r = await gw.inject({ url: '/api/identidad/dos-cookies', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(200);
    expect(r.headers['set-cookie']).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/']);
  });

  test('4xx del destino pasa sin cambios', async () => {
    const r = await gw.inject({ url: '/api/identidad/conflicto', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ code: 'CONFLICTO', message: 'Ya existe', details: [{ campo: 'slug' }] });
  });
});

describe('rutas con segmentos de punto o barras codificadas', () => {
  const malas = [
    '/api/identidad/x/../auth/sign-in/email',
    '/api/identidad/x/%2e%2e/registro',
    '/api/identidad/x/%2E%2e/auth/sign-in/email',
    '/api/identidad/x/.%2E/registro',
    '/api/identidad/x/./y',
    '/api/identidad/a%2Fb',
    '/api/identidad/a%5Cb',
    '/api/identidad//registro',
    '/api/auditoria/x/../eventos',
  ];

  test('con token válido → 400 VALIDACION y el destino no recibe nada', async () => {
    const h = auth(await jwks.sign(claims));
    const antes = recibidos;
    for (const url of malas) {
      const r = await crudo(gw, 'POST', url, h);
      expect(r.status, url).toBe(400);
      expect(r.json.code).toBe('VALIDACION');
    }
    expect(recibidos).toBe(antes);
  });

  test('sin token también → 400 (se rechaza antes de autenticar), también en rutas públicas', async () => {
    const antes = recibidos;
    for (const url of [...malas, '/api/identidad/registro/../miembros', '/api/identidad/auth/../miembros']) {
      expect((await crudo(gw, 'POST', url)).status, url).toBe(400);
    }
    expect(recibidos).toBe(antes);
  });

  test('caracteres codificados legítimos siguen pasando', async () => {
    const r = await gw.inject({ url: '/api/auditoria/eventos?q=%C3%B1', headers: auth(await jwks.sign(claims)) });
    expect(r.statusCode).toBe(200);
    expect(r.json().url).toBe('/eventos?q=%C3%B1');
    const p = await gw.inject({ url: '/api/identidad/medicos/%C3%B1/perfil', headers: auth(await jwks.sign(claims)) });
    expect(p.json().url).toBe('/medicos/%C3%B1/perfil');
  });
});

describe('OPTIONS no se proxea (sin CORS en la fase 0)', () => {
  test('OPTIONS sin token → 401', async () => {
    expect((await gw.inject({ method: 'OPTIONS', url: '/api/auditoria/eventos' })).statusCode).toBe(401);
  });
  test('OPTIONS en ruta pública o con token → 404 uniforme', async () => {
    const a = await gw.inject({ method: 'OPTIONS', url: '/api/identidad/registro' });
    expect(a.statusCode).toBe(404);
    expect(a.json().code).toBe('NO_ENCONTRADO');
    const b = await gw.inject({ method: 'OPTIONS', url: '/api/auditoria/eventos', headers: auth(await jwks.sign(claims)) });
    expect(b.statusCode).toBe(404);
    expect(b.json().code).toBe('NO_ENCONTRADO');
  });
});

describe('rate limit por IP', () => {
  test('429 tras el límite en rutas públicas', async () => {
    const g = await nuevo({ limitePublicoPorMin: 2 });
    for (let i = 0; i < 2; i++) expect((await g.inject(registroReq)).statusCode).toBe(200);
    const r = await g.inject(registroReq);
    expect(r.statusCode).toBe(429);
    expect(r.json().message).toBeTruthy();
    expect(r.headers['x-trace-id']).toBeTruthy();
    expect(r.headers['retry-after']).toBeTruthy();
  });

  test('aplica a rutas de sesión, auth y jwks; es por IP', async () => {
    const g = await nuevo({ limitePublicoPorMin: 1 });
    for (const url of ['/api/identidad/tenants/mios', '/api/identidad/.well-known/jwks.json', '/api/identidad/auth/get-session']) {
      expect((await g.inject({ url, remoteAddress: '10.9.0.1' })).statusCode).toBe(200);
      expect((await g.inject({ url, remoteAddress: '10.9.0.1' })).statusCode).toBe(429);
    }
    expect((await g.inject({ url: '/api/identidad/tenants/mios', remoteAddress: '10.9.0.2' })).statusCode).toBe(200);
    const sesion = { method: 'POST' as const, url: '/api/identidad/sesion/tenant', payload: {}, remoteAddress: '10.9.0.3' };
    expect((await g.inject(sesion)).statusCode).toBe(200);
    expect((await g.inject(sesion)).statusCode).toBe(429);
  });

  test('no limita las rutas protegidas', async () => {
    const g = await nuevo({ limitePublicoPorMin: 1 });
    const h = auth(await jwks.sign(claims));
    for (let i = 0; i < 3; i++) expect((await g.inject({ url: '/api/auditoria/eventos', headers: h })).statusCode).toBe(200);
  });

  test('confiarEnProxy (CIDR del balanceador) usa la IP de X-Forwarded-For como clave', async () => {
    const g = await nuevo({ limitePublicoPorMin: 1, confiarEnProxy: '10.0.0.0/8' });
    const req = (ip: string) => ({ ...registroReq, remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': ip } });
    expect((await g.inject(req('203.0.113.1'))).statusCode).toBe(200);
    expect((await g.inject(req('203.0.113.2'))).statusCode).toBe(200);
    expect((await g.inject(req('203.0.113.1'))).statusCode).toBe(429);
  });

  test('sin confiarEnProxy, X-Forwarded-For no evade el límite', async () => {
    const g = await nuevo({ limitePublicoPorMin: 1 });
    const req = (ip: string) => ({ ...registroReq, remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': ip } });
    expect((await g.inject(req('203.0.113.1'))).statusCode).toBe(200);
    expect((await g.inject(req('203.0.113.2'))).statusCode).toBe(429);
  });
});

describe('destino no disponible', () => {
  test('destino caído → 503 uniforme con x-trace-id', async () => {
    const muerto = await iniciarDestino();
    const url = muerto.url;
    await muerto.stop();
    const g = await nuevo({ destinos: { identidad: url, auditoria: url, agenda: url } });
    const r = await g.inject(registroReq);
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ code: 'INTERNO', message: 'Servicio no disponible' });
    expect(r.headers['x-trace-id']).toBeTruthy();
    const p = await g.inject({ url: '/api/auditoria/eventos', headers: auth(await jwks.sign(claims)) });
    expect(p.statusCode).toBe(503);
  });

  test('timeout del destino → 503', async () => {
    const lento = createServer(() => {
      /* nunca responde */
    });
    await new Promise<void>((r) => lento.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(lento.address() as AddressInfo).port}`;
    const g = await nuevo({ destinos: { identidad: url, auditoria: url, agenda: url }, timeoutDestinoMs: 200 });
    const r = await g.inject(registroReq);
    expect(r.statusCode).toBe(503);
    expect(r.json().message).toBe('Servicio no disponible');
    await new Promise<void>((r2) => {
      lento.close(() => r2());
      lento.closeAllConnections();
    });
  });
});

describe('límite del cuerpo', () => {
  const imagen = (bytes: number): Buffer => Buffer.alloc(bytes, 1);

  test('acepta 1.5 MB en PUT /api/identidad/consultorio/logo y lo reenvía íntegro', async () => {
    const r = await gw.inject({ method: 'PUT', url: '/api/identidad/consultorio/logo', headers: { ...auth(await jwks.sign(claims)), 'content-type': 'image/png' }, payload: imagen(1_500_000) });
    expect(r.statusCode).toBe(200);
    const eco = r.json() as { method: string; url: string };
    expect(eco).toMatchObject({ method: 'PUT', url: '/consultorio/logo' });
    expect((r.json() as { body: string }).body).toHaveLength(1_500_000);
  });

  test('rechaza más de 2 MB en el logo', async () => {
    const r = await gw.inject({ method: 'PUT', url: '/api/identidad/consultorio/logo', headers: { ...auth(await jwks.sign(claims)), 'content-type': 'image/png' }, payload: imagen(2_200_000) });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ code: 'VALIDACION', message: 'El logo debe pesar menos de 1 MB', details: { campo: 'logo' } });
  });

  test('rechaza más de 1 MB en cualquier otra ruta (también PUT de otra ruta y el logo por GET/POST)', async () => {
    const headers = { ...auth(await jwks.sign(claims)), 'content-type': 'application/octet-stream' };
    for (const [method, url] of [
      ['PUT', '/api/identidad/consultorio/otra'],
      ['POST', '/api/identidad/consultorio/logo'],
      ['POST', '/api/agenda/citas'],
    ] as const) {
      const r = await gw.inject({ method, url, headers, payload: imagen(1_500_000) });
      expect(r.statusCode, `${method} ${url}`).toBe(413);
      expect(r.json(), `${method} ${url}`).toMatchObject({ code: 'VALIDACION', message: 'Solicitud inválida' });
    }
  });
});
