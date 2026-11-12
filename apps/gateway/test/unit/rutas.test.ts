import { describe, expect, test } from 'vitest';
import { clasificarRuta, rutaPermitida, urlDestino, filtrarCabecerasPeticion, filtrarCabecerasRespuesta, RUTAS_PUBLICAS } from '../../src/rutas.js';

describe('clasificarRuta', () => {
  test.each([
    ['POST', '/api/identidad/registro', 'publica'],
    ['GET', '/api/identidad/auth/get-session', 'publica'],
    ['POST', '/api/identidad/auth/sign-in/email', 'publica'],
    ['GET', '/api/identidad/.well-known/jwks.json', 'publica'],
    ['GET', '/api/identidad/tenants/mios', 'sesion'],
    ['POST', '/api/identidad/sesion/tenant', 'sesion'],
    ['GET', '/api/identidad/miembros', 'protegida'],
    ['GET', '/api/auditoria/eventos', 'protegida'],
    ['GET', '/api/agenda/medicos', 'protegida'],
    ['POST', '/api/agenda/citas', 'protegida'],
    ['PATCH', '/api/agenda/citas/abc', 'protegida'],
    ['PUT', '/api/agenda/medicos/abc/horario', 'protegida'],
    ['GET', '/api/identidad/registro', 'protegida'],
    ['POST', '/api/identidad/tenants/mios', 'protegida'],
    ['DELETE', '/api/identidad/auth/x', 'protegida'],
    ['GET', '/api/identidad/auth', 'protegida'],
    ['POST', '/api/identidad/registro/', 'protegida'],
    ['POST', '/api/identidad/registro/../miembros', 'protegida'],
    ['POST', '/api/identidad/auth/%2e%2e/miembros', 'protegida'],
    ['GET', '/api/auditoria/.well-known/jwks.json', 'protegida'],
  ])('%s %s → %s', (metodo, url, acceso) => {
    expect(clasificarRuta(metodo, url)?.acceso).toBe(acceso);
  });

  test.each(['/', '/health', '/api', '/api/identidad', '/api/otro/x', '/apix/identidad/x', '/api/identidadx/y'])(
    'ruta desconocida %s → null',
    (url) => {
      expect(clasificarRuta('GET', url)).toBeNull();
    },
  );

  test('reescribe el prefijo y conserva query y caracteres codificados', () => {
    expect(clasificarRuta('POST', '/api/identidad/registro')).toMatchObject({ servicio: 'identidad', rutaDestino: '/registro' });
    expect(clasificarRuta('GET', '/api/auditoria/eventos?limite=5&x=a%20b')).toMatchObject({
      servicio: 'auditoria',
      rutaDestino: '/eventos?limite=5&x=a%20b',
    });
    expect(clasificarRuta('GET', '/api/identidad/medicos/abc/perfil?q=%C3%B1&r=%2F')?.rutaDestino).toBe('/medicos/abc/perfil?q=%C3%B1&r=%2F');
  });

  test('rutas /api/agenda/* son protegidas y se enrutan a AGENDA_URL', () => {
    expect(clasificarRuta('GET', '/api/agenda/medicos/abc/disponibilidad?fecha=2030-01-07&tipoCitaId=x')).toEqual({
      servicio: 'agenda',
      rutaDestino: '/medicos/abc/disponibilidad?fecha=2030-01-07&tipoCitaId=x',
      acceso: 'protegida',
    });
    expect(urlDestino('http://svc-agenda:3004', '/citas/abc/estado')).toBe('http://svc-agenda:3004/citas/abc/estado');
    expect(clasificarRuta('GET', '/api/agenda')).toBeNull();
  });

  test('RUTAS_PUBLICAS solo contiene rutas de identidad', () => {
    expect(RUTAS_PUBLICAS.every((r) => r.startsWith('/api/identidad/'))).toBe(true);
  });
});

describe('filtrarCabecerasPeticion', () => {
  const ctx = { traceId: 'trace-ok', ip: '203.0.113.9', protocolo: 'https', servicio: 'identidad' as const };

  test('reenvía solo las permitidas y reemplaza el trace id', () => {
    const r = filtrarCabecerasPeticion(
      {
        authorization: 'Bearer abc',
        cookie: 'a=1; b=2',
        'content-type': 'application/json',
        'x-trace-id': 'crudo-del-cliente',
        connection: 'keep-alive, x-secreto',
        'keep-alive': 'timeout=5',
        'transfer-encoding': 'chunked',
        upgrade: 'websocket',
        'proxy-authorization': 'x',
        te: 'trailers',
        'x-secreto': 'no',
        'x-forwarded-for': '1.2.3.4',
        'x-forwarded-proto': 'http',
        host: 'gateway',
        'content-length': '99',
        'x-otro': 'no',
      },
      ctx,
    );
    expect(r).toEqual({
      authorization: 'Bearer abc',
      cookie: 'a=1; b=2',
      'content-type': 'application/json',
      'x-trace-id': 'trace-ok',
      'x-forwarded-for': '203.0.113.9',
      'x-forwarded-proto': 'https',
    });
  });

  test('omite las ausentes', () => {
    expect(filtrarCabecerasPeticion({}, ctx)).toEqual({
      'x-trace-id': 'trace-ok',
      'x-forwarded-for': '203.0.113.9',
      'x-forwarded-proto': 'https',
    });
  });

  test('F4: la cookie (sesión de Better Auth) solo se reenvía a identidad, nunca a auditoria', () => {
    const entrantes = { authorization: 'Bearer abc', cookie: 'better-auth.session_token=s' };
    expect(filtrarCabecerasPeticion(entrantes, { ...ctx, servicio: 'auditoria' })).toEqual({
      authorization: 'Bearer abc',
      'x-trace-id': 'trace-ok',
      'x-forwarded-for': '203.0.113.9',
      'x-forwarded-proto': 'https',
    });
    expect(filtrarCabecerasPeticion(entrantes, ctx).cookie).toBe('better-auth.session_token=s');
  });

  test('reenvía origin y user-agent (Better Auth valida el origen)', () => {
    const r = filtrarCabecerasPeticion({ origin: 'https://app.example', 'user-agent': 'ua' }, ctx);
    expect(r).toMatchObject({ origin: 'https://app.example', 'user-agent': 'ua' });
  });
});

describe('filtrarCabecerasRespuesta', () => {
  test('quita hop-by-hop y el trace id, conserva Set-Cookie múltiple', () => {
    const r = filtrarCabecerasRespuesta({
      'content-type': 'application/json',
      'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
      connection: 'close, x-interno',
      'x-interno': 'x',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      'x-trace-id': 'del-destino',
      'x-propio': 'ok',
    });
    expect(r).toEqual({
      'content-type': 'application/json',
      'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
      'x-propio': 'ok',
    });
  });
});

describe('rutaPermitida', () => {
  test.each([
    '/api/identidad/miembros',
    '/api/identidad/medicos/%C3%B1/perfil?q=%C3%B1&r=%2F&s=%2e',
    '/api/identidad/a.b/c..d/.well-known/jwks.json',
    '/api/identidad/x/..hidden',
    '/api/auditoria/eventos?ruta=../x',
  ])('permite %s', (u) => {
    expect(rutaPermitida(u)).toBe(true);
  });

  test.each([
    '/api/identidad/x/../auth/sign-in/email',
    '/api/identidad/x/./y',
    '/api/identidad/x/..',
    '/api/identidad/x/.',
    '/api/identidad/x/%2e%2e/registro',
    '/api/identidad/x/%2E%2e/registro',
    '/api/identidad/x/.%2E/registro',
    '/api/identidad/x/%2e/y',
    '/api/identidad/a%2Fb',
    '/api/identidad/a%2fb',
    '/api/identidad/a\\b',
    '/api/identidad/a%5Cb',
    '/api/identidad/a%5cb',
    '/api/identidad//a',
    '/api/identidad/a//b?x=1',
  ])('rechaza %s', (u) => {
    expect(rutaPermitida(u)).toBe(false);
  });
});

describe('urlDestino', () => {
  test('devuelve la URL cuando el destino conserva exactamente la ruta', () => {
    expect(urlDestino('http://i:3001', '/registro')).toBe('http://i:3001/registro');
    expect(urlDestino('http://i:3001/', '/eventos?limite=5&x=a%20b')).toBe('http://i:3001/eventos?limite=5&x=a%20b');
    expect(urlDestino('http://i/base', '/m/%C3%B1')).toBe('http://i/base/m/%C3%B1');
  });

  test.each(['/a/../auth/x', '/a/%2e%2e/registro', '/a/.%2E/registro', '/a/./b', '/a b', '/x?', '/a\\b'])(
    'null si la normalización cambiaría %s',
    (r) => {
      expect(urlDestino('http://i:3001', r)).toBeNull();
    },
  );

  test('null si la base no es una URL válida', () => {
    expect(urlDestino('no-url', '/x')).toBeNull();
  });
});
