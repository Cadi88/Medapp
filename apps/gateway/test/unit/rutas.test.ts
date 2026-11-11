import { describe, expect, test } from 'vitest';
import { clasificarRuta, filtrarCabecerasPeticion, filtrarCabecerasRespuesta, RUTAS_PUBLICAS } from '../../src/rutas.js';

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
    expect(clasificarRuta('GET', '/api/identidad/medicos/a%2Fb/perfil?q=%C3%B1')?.rutaDestino).toBe('/medicos/a%2Fb/perfil?q=%C3%B1');
  });

  test('RUTAS_PUBLICAS solo contiene rutas de identidad', () => {
    expect(RUTAS_PUBLICAS.every((r) => r.startsWith('/api/identidad/'))).toBe(true);
  });
});

describe('filtrarCabecerasPeticion', () => {
  const ctx = { traceId: 'trace-ok', ip: '203.0.113.9', protocolo: 'https' };

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
