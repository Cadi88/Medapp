// @vitest-environment node
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { crearAlmacenCookies } from '../apoyo/cookies-falsas.js';

const falsas = vi.hoisted(() => ({ ref: undefined as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => falsas.ref }));

const { llamarGateway, ipDelCliente } = await import('@/lib/api/gateway');

const c = crearAlmacenCookies();
falsas.ref = c.almacen;
const fetchFalso = vi.fn<typeof fetch>();

function respuestaJson(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

function peticion(i = 0): { url: string; init: RequestInit; headers: Headers } {
  const [url, init = {}] = fetchFalso.mock.calls[i] ?? [];
  return { url: String(url), init, headers: new Headers(init.headers) };
}

beforeEach(() => {
  c.limpiar();
  fetchFalso.mockReset();
  vi.stubGlobal('fetch', fetchFalso);
  vi.stubEnv('GATEWAY_URL', 'http://gateway:8080');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const esquema = z.object({ id: z.string() });

describe('llamarGateway', () => {
  test('llamarGateway agrega Bearer con auth token y valida con esquema', async () => {
    c.poner('token_consultorio', 'jwt.del.tenant');
    fetchFalso.mockResolvedValue(respuestaJson(200, { id: 'c1', extra: 'se descarta' }));

    const r = await llamarGateway('/api/identidad/consultorio', { auth: 'token', esquema });

    expect(r).toEqual({ ok: true, datos: { id: 'c1' } });
    const p = peticion();
    expect(p.url).toBe('http://gateway:8080/api/identidad/consultorio');
    expect(p.init.method).toBe('GET');
    expect(p.headers.get('authorization')).toBe('Bearer jwt.del.tenant');
    expect(p.headers.get('cookie')).toBeNull();
  });

  test('respuesta que no cumple el esquema → ok:false 502 INTERNO', async () => {
    c.poner('token_consultorio', 't');
    fetchFalso.mockResolvedValue(respuestaJson(200, { id: 42 }));

    const r = await llamarGateway('/api/agenda/citas', { auth: 'token', esquema });

    expect(r).toMatchObject({ ok: false, status: 502, error: { code: 'INTERNO' } });
  });

  test('error de red → ok:false 503', async () => {
    fetchFalso.mockRejectedValue(new TypeError('fetch failed'));

    const r = await llamarGateway('/api/agenda/citas', { auth: 'token' });

    expect(r).toMatchObject({ ok: false, status: 503, error: { code: 'INTERNO' } });
  });

  test('cookie de sesión solo se envía a /api/identidad/', async () => {
    c.poner('better-auth.session_token', 'abc.firma/+=');
    c.poner('better-auth.two_factor', 'xyz');
    c.poner('consultorio_id', 'no-se-reenvia');
    fetchFalso.mockImplementation(async () => respuestaJson(200, {}));

    await llamarGateway('/api/identidad/tenants/mios', { auth: 'sesion' });
    await llamarGateway('/api/agenda/citas', { auth: 'sesion' });

    expect(peticion(0).headers.get('cookie')).toBe('better-auth.session_token=abc.firma%2F%2B%3D; better-auth.two_factor=xyz');
    expect(peticion(1).headers.get('cookie')).toBeNull();
  });

  test('sin token no agrega Authorization; sin sesión no agrega Cookie', async () => {
    fetchFalso.mockImplementation(async () => respuestaJson(200, {}));

    await llamarGateway('/api/agenda/citas', { auth: 'token' });
    await llamarGateway('/api/identidad/tenants/mios', { auth: 'sesion' });

    expect(peticion(0).headers.get('authorization')).toBeNull();
    expect(peticion(1).headers.get('cookie')).toBeNull();
  });

  test('cabecera de cookie explícita (proxy) sustituye a las cookies de la petición', async () => {
    c.poner('better-auth.session_token', 'de-next');
    fetchFalso.mockResolvedValue(respuestaJson(200, { token: 't' }));

    await llamarGateway('/api/identidad/sesion/tenant', {
      metodo: 'POST',
      auth: 'sesion',
      cabeceraCookie: 'better-auth.session_token=del-proxy',
    });

    expect(peticion().headers.get('cookie')).toBe('better-auth.session_token=del-proxy');
  });

  test('envía el cuerpo como JSON, X-Forwarded-For y método', async () => {
    c.poner('token_consultorio', 't');
    fetchFalso.mockResolvedValue(new Response(null, { status: 204 }));

    const r = await llamarGateway('/api/agenda/citas/1', {
      metodo: 'PATCH',
      cuerpo: { estado: 'confirmada' },
      auth: 'token',
      ip: '203.0.113.7, 10.0.0.2',
    });

    expect(r).toEqual({ ok: true, datos: undefined });
    const p = peticion();
    expect(p.init.method).toBe('PATCH');
    expect(p.init.body).toBe('{"estado":"confirmada"}');
    expect(p.headers.get('content-type')).toBe('application/json');
    expect(p.headers.get('x-forwarded-for')).toBe('203.0.113.7, 10.0.0.2');
  });

  test('error del gateway con formato de la API → status y error tal cual', async () => {
    fetchFalso.mockResolvedValue(respuestaJson(409, { code: 'HORARIO_OCUPADO', message: 'Ocupado' }));

    const r = await llamarGateway('/api/agenda/citas', { metodo: 'POST', cuerpo: {}, auth: 'token' });

    expect(r).toEqual({ ok: false, status: 409, error: { code: 'HORARIO_OCUPADO', message: 'Ocupado' } });
  });

  test('entrega los set-cookie con auth sesion o ninguna, nunca con token', async () => {
    const conCookies = () => {
      const h = new Headers({ 'content-type': 'application/json' });
      h.append('set-cookie', 'better-auth.session_token=s; Max-Age=600; Path=/; HttpOnly');
      h.append('set-cookie', 'better-auth.session_data=d; Path=/');
      return new Response('{}', { status: 200, headers: h });
    };
    fetchFalso.mockImplementation(async () => conCookies());

    const ninguna = await llamarGateway('/api/identidad/auth/sign-in/email', { metodo: 'POST', cuerpo: {}, auth: 'ninguna' });
    const sesion = await llamarGateway('/api/identidad/auth/sign-out', { metodo: 'POST', auth: 'sesion' });
    const token = await llamarGateway('/api/identidad/consultorio', { auth: 'token' });

    expect(ninguna.setCookies).toEqual([
      'better-auth.session_token=s; Max-Age=600; Path=/; HttpOnly',
      'better-auth.session_data=d; Path=/',
    ]);
    expect(sesion.setCookies).toHaveLength(2);
    expect(token.setCookies).toBeUndefined();
  });

  test('cuerpo de error ilegible → 401 NO_AUTENTICADO / otros INTERNO', async () => {
    fetchFalso.mockResolvedValueOnce(new Response('no es json', { status: 401 }));
    fetchFalso.mockResolvedValueOnce(new Response('<html>', { status: 500 }));

    const r401 = await llamarGateway('/api/identidad/auth/sign-in/email', { metodo: 'POST', cuerpo: {}, auth: 'ninguna' });
    const r500 = await llamarGateway('/api/agenda/citas', { auth: 'token' });

    expect(r401).toMatchObject({ ok: false, status: 401, error: { code: 'NO_AUTENTICADO' } });
    expect(r500).toMatchObject({ ok: false, status: 500, error: { code: 'INTERNO' } });
  });

  test('sin GATEWAY_URL → error de configuración', async () => {
    vi.stubEnv('GATEWAY_URL', '');

    await expect(llamarGateway('/api/agenda/citas', { auth: 'token' })).rejects.toThrow('GATEWAY_URL');
  });
});

describe('URL normalizada', () => {
  test.each([
    ['/api/identidad/../agenda/x', 'http://gateway:8080/api/agenda/x'],
    ['/api/identidad/%2e%2e/agenda/x', 'http://gateway:8080/api/agenda/x'],
    ['/api/identidad/%2E%2E/agenda/x', 'http://gateway:8080/api/agenda/x'],
  ])('%s se normaliza fuera de identidad: no lleva la cookie de sesión', async (ruta, url) => {
    c.poner('better-auth.session_token', 's');
    fetchFalso.mockImplementation(async () => respuestaJson(200, {}));

    await llamarGateway(ruta, { auth: 'sesion' });

    expect(peticion().url).toBe(url);
    expect(peticion().headers.get('cookie')).toBeNull();
  });

  test('una ruta de identidad con segmentos que se normalizan dentro de identidad sí lleva la cookie', async () => {
    c.poner('better-auth.session_token', 's');
    fetchFalso.mockImplementation(async () => respuestaJson(200, {}));

    await llamarGateway('/api/agenda/../identidad/tenants/mios', { auth: 'sesion' });

    expect(peticion().url).toBe('http://gateway:8080/api/identidad/tenants/mios');
    expect(peticion().headers.get('cookie')).toBe('better-auth.session_token=s');
  });

  test.each([['api/identidad/x'], ['@otro-host/api/identidad/x'], ['http://otro-host/api/identidad/x'], ['//otro-host/api/identidad/x']])(
    'ruta %j que no empieza con / o cambia de origen → se rechaza sin llamar',
    async (ruta) => {
      c.poner('better-auth.session_token', 's');

      await expect(llamarGateway(ruta, { auth: 'sesion' })).rejects.toThrow('Ruta del gateway inválida');
      expect(fetchFalso).not.toHaveBeenCalled();
    },
  );
});

describe('ipDelCliente', () => {
  test('toma solo el último salto de X-Forwarded-For: el que agrega el proxy inverso que debe ir delante de web', () => {
    expect(ipDelCliente(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe('203.0.113.7');
    expect(ipDelCliente(new Headers({ 'x-forwarded-for': ' 203.0.113.7 ' }))).toBe('203.0.113.7');
  });

  test('sin X-Forwarded-For (o vacío) no se envía ninguno', () => {
    expect(ipDelCliente(new Headers())).toBeUndefined();
    expect(ipDelCliente(new Headers({ 'x-forwarded-for': ' , ' }))).toBeUndefined();
  });
});

describe('llamarGateway · Origin hacia Better Auth (R11)', () => {
  beforeEach(() => {
    vi.stubEnv('WEB_ORIGEN', 'http://localhost:3000');
    fetchFalso.mockImplementation(async () => respuestaJson(200, {}));
  });

  test('envía Origin: WEB_ORIGEN a /api/identidad/auth/*', async () => {
    await llamarGateway('/api/identidad/auth/two-factor/verify-totp', { metodo: 'POST', cuerpo: { code: '123456' }, auth: 'sesion' });
    expect(peticion().headers.get('origin')).toBe('http://localhost:3000');
  });

  test('no envía Origin a otras rutas', async () => {
    await llamarGateway('/api/identidad/tenants/mios', { auth: 'sesion' });
    await llamarGateway('/api/agenda/citas', { auth: 'token' });
    expect(peticion(0).headers.get('origin')).toBeNull();
    expect(peticion(1).headers.get('origin')).toBeNull();
  });

  test('sin WEB_ORIGEN no envía Origin', async () => {
    vi.stubEnv('WEB_ORIGEN', '');
    await llamarGateway('/api/identidad/auth/sign-out', { metodo: 'POST', auth: 'sesion' });
    expect(peticion().headers.get('origin')).toBeNull();
  });
});
