// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { crearAlmacenCookies } from '../apoyo/cookies-falsas.js';

const falsas = vi.hoisted(() => ({ ref: undefined as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => falsas.ref }));

const {
  cabeceraCookieAuth,
  cabeceraCookieAuthDe,
  cerrarSesion,
  esCookieDeSesion,
  guardarConsultorio,
  guardarCookiesAuth,
  guardarToken,
  interpretarSetCookie,
  leerConsultorio,
  leerToken,
  olvidarConsultorio,
} = await import('@/lib/sesion/cookies');

const c = crearAlmacenCookies();
falsas.ref = c.almacen;

beforeEach(() => c.limpiar());
afterEach(() => vi.unstubAllEnvs());

describe('guardarCookiesAuth', () => {
  test('guardarCookiesAuth replica solo cookies de Better Auth, httpOnly y sameSite lax', async () => {
    await guardarCookiesAuth([
      'better-auth.session_token=abc.firma%2F%2B%3D; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax',
      '__Secure-better-auth.two_factor=xyz; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax',
      'otra_cookie=intrusa; Path=/',
    ]);

    expect(c.sets).toEqual([
      { name: 'better-auth.session_token', value: 'abc.firma/+=', httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 604800 },
      // Prefijo __Secure-: el navegador la rechaza sin Secure, así que siempre lo lleva aunque COOKIE_SEGURA no esté.
      { name: '__Secure-better-auth.two_factor', value: 'xyz', httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 600 },
    ]);
  });

  test('__Host- también va siempre con Secure', async () => {
    await guardarCookiesAuth(['__Host-better-auth.session_token=h; Path=/']);

    expect(c.sets[0]).toMatchObject({ name: '__Host-better-auth.session_token', secure: true, path: '/' });
  });

  test('con COOKIE_SEGURA=true las cookies son Secure', async () => {
    vi.stubEnv('COOKIE_SEGURA', 'true');

    await guardarCookiesAuth(['better-auth.session_token=s; Path=/']);

    expect(c.sets[0]).toMatchObject({ name: 'better-auth.session_token', secure: true, httpOnly: true });
    expect(c.sets[0]?.maxAge).toBeUndefined();
  });

  test('una cookie que Better Auth borra (Max-Age=0) se borra también en Next', async () => {
    c.poner('better-auth.session_token', 'vieja');

    await guardarCookiesAuth(['better-auth.session_token=; Max-Age=0; Path=/']);

    expect(c.almacen.has('better-auth.session_token')).toBe(false);
  });
});

describe('interpretarSetCookie', () => {
  test('lee nombre, valor decodificado, Max-Age y Expires', () => {
    expect(interpretarSetCookie('a=b%20c; Expires=Wed, 11 Nov 2026 16:00:00 GMT; Path=/')).toEqual({
      name: 'a',
      value: 'b c',
      expires: new Date('2026-11-11T16:00:00Z'),
    });
    expect(interpretarSetCookie('a=1=2; max-age=10')).toEqual({ name: 'a', value: '1=2', maxAge: 10 });
  });

  test.each([[''], ['sin-igual'], ['=valor']])('cabecera inválida %j → null', (s) => expect(interpretarSetCookie(s)).toBeNull());

  test('valor mal codificado se conserva tal cual; Max-Age o Expires inválidos se ignoran', () => {
    expect(interpretarSetCookie('a=%E0%A4%A; Max-Age=nunca; Expires=nunca')).toEqual({ name: 'a', value: '%E0%A4%A' });
  });
});

describe('cabecera de cookies hacia identidad', () => {
  test('cabeceraCookieAuthDe incluye solo cookies de Better Auth, codificadas', () => {
    expect(
      cabeceraCookieAuthDe([
        { name: 'better-auth.session_token', value: 'a/b' },
        { name: 'token_consultorio', value: 'jwt' },
        { name: '__Secure-better-auth.two_factor', value: 'z' },
      ]),
    ).toBe('better-auth.session_token=a%2Fb; __Secure-better-auth.two_factor=z');
  });

  test('cabeceraCookieAuth lee las cookies de la petición', async () => {
    c.poner('better-auth.session_token', 's');
    c.poner('consultorio_id', 'c');

    expect(await cabeceraCookieAuth()).toBe('better-auth.session_token=s');
  });
});

describe('token y consultorio', () => {
  test('guardarToken/leerToken y guardarConsultorio/leerConsultorio usan cookies httpOnly', async () => {
    expect(await leerToken()).toBeUndefined();
    expect(await leerConsultorio()).toBeUndefined();

    await guardarToken('jwt');
    await guardarConsultorio('c1');

    expect(await leerToken()).toBe('jwt');
    expect(await leerConsultorio()).toBe('c1');
    expect(c.sets).toEqual([
      expect.objectContaining({ name: 'token_consultorio', httpOnly: true, sameSite: 'lax', maxAge: 900 }),
      expect.objectContaining({ name: 'consultorio_id', httpOnly: true, sameSite: 'lax' }),
    ]);
  });

  test('cerrarSesion borra Better Auth, token y consultorio, y deja las demás', async () => {
    c.poner('better-auth.session_token', 's');
    c.poner('better-auth.two_factor', 't');
    c.poner('token_consultorio', 'jwt');
    c.poner('consultorio_id', 'c1');
    c.poner('preferencia', 'oscuro');

    await cerrarSesion();

    expect(c.almacen.getAll().map((x) => x.name)).toEqual(['preferencia']);
  });

  test('cerrarSesion borra las cookies __Secure- con Secure (si no, el navegador ignora el borrado)', async () => {
    c.poner('__Secure-better-auth.session_token', 's');
    c.poner('token_consultorio', 'jwt');

    await cerrarSesion();

    expect(c.sets).toEqual([
      expect.objectContaining({ name: '__Secure-better-auth.session_token', value: '', maxAge: 0, secure: true }),
      expect.objectContaining({ name: 'token_consultorio', value: '', maxAge: 0, secure: false }),
    ]);
  });

  test('olvidarConsultorio borra solo el token y el consultorio elegido (no la sesión de Better Auth)', async () => {
    c.poner('better-auth.session_token', 's');
    c.poner('token_consultorio', 'jwt-anterior');
    c.poner('consultorio_id', 'c-anterior');

    await olvidarConsultorio();

    expect(c.almacen.getAll().map((x) => x.name)).toEqual(['better-auth.session_token']);
    expect(c.sets).toEqual([
      expect.objectContaining({ name: 'token_consultorio', value: '', maxAge: 0, httpOnly: true }),
      expect.objectContaining({ name: 'consultorio_id', value: '', maxAge: 0, httpOnly: true }),
    ]);
  });

  test('esCookieDeSesion', () => {
    expect(['better-auth.session_token', 'token_consultorio', 'consultorio_id', 'preferencia'].map(esCookieDeSesion)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
