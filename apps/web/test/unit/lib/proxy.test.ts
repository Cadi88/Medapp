// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { config, proxy } from '@/proxy';
import { tokenQueVence } from '../apoyo/jwt.js';

const fetchFalso = vi.fn<typeof fetch>();
const SESION = 'better-auth.session_token=s%2Fesion';
const CONSULTORIO = '0192f0a0-0000-7000-8000-000000000002';

function peticion(ruta: string, cookies: string[] = [], cabeceras: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${ruta}`, { headers: { cookie: cookies.join('; '), ...cabeceras } });
}

function respuestaJson(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

const destino = (r: Response) => r.headers.get('location');

beforeEach(() => {
  fetchFalso.mockReset();
  vi.stubGlobal('fetch', fetchFalso);
  vi.stubEnv('GATEWAY_URL', 'http://gateway:8080');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('acceso por ruta', () => {
  test.each(['/login', '/login/mfa', '/registro'])('%s es pública: pasa sin sesión', async (ruta) => {
    const r = await proxy(peticion(ruta));
    expect(destino(r)).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  test('sin cookie de Better Auth → /login', async () => {
    const r = await proxy(peticion('/agenda', ['token_consultorio=x', `consultorio_id=${CONSULTORIO}`]));
    expect(destino(r)).toBe('http://localhost:3000/login');
  });

  test('una ruta que solo empieza como pública no es pública', async () => {
    expect(destino(await proxy(peticion('/login-falso')))).toBe('http://localhost:3000/login');
  });

  test.each(['/cambiar-password', '/configurar-mfa', '/elegir-consultorio', '/sin-acceso'])(
    '%s solo exige sesión (sin consultorio ni token)',
    async (ruta) => {
      expect(destino(await proxy(peticion(ruta)))).toBe('http://localhost:3000/login');
      const r = await proxy(peticion(ruta, [SESION]));
      expect(destino(r)).toBeNull();
      expect(fetchFalso).not.toHaveBeenCalled();
    },
  );

  test('con sesión pero sin consultorio_id → /elegir-consultorio', async () => {
    const r = await proxy(peticion('/agenda', [SESION]));
    expect(destino(r)).toBe('http://localhost:3000/elegir-consultorio');
  });

  test('token vigente → pasa sin llamar al gateway', async () => {
    const t = tokenQueVence(new Date(), 600);
    const r = await proxy(peticion('/agenda', [SESION, `consultorio_id=${CONSULTORIO}`, `token_consultorio=${t}`]));
    expect(destino(r)).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  test.each([
    ['GET', 307],
    ['HEAD', 307],
    ['POST', 303],
    ['PUT', 303],
  ])('redirección de %s → %i (un POST de server action no se reenvía como POST a /login)', async (method, status) => {
    const r = await proxy(new NextRequest('http://localhost:3000/agenda', { method }));
    expect(r.status).toBe(status);
    expect(destino(r)).toBe('http://localhost:3000/login');
  });

  test('el matcher excluye estáticos de Next', () => {
    expect(config.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)']);
  });
});

describe('renovación del token', () => {
  test('Review Focus 4: proxy renueva un token por vencer y lo escribe en la respuesta', async () => {
    const nuevo = tokenQueVence(new Date(), 900);
    fetchFalso.mockResolvedValue(respuestaJson(200, { token: nuevo }));
    const viejo = tokenQueVence(new Date(), 30);

    const r = await proxy(
      peticion('/agenda', [SESION, `consultorio_id=${CONSULTORIO}`, `token_consultorio=${viejo}`], { 'x-forwarded-for': '203.0.113.7' }),
    );

    // Llamada al gateway: sesión de Better Auth, tenant elegido e IP del cliente.
    const [url, init = {}] = fetchFalso.mock.calls[0] ?? [];
    const h = new Headers(init.headers);
    expect(String(url)).toBe('http://gateway:8080/api/identidad/sesion/tenant');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ tenantId: CONSULTORIO });
    expect(h.get('cookie')).toBe(SESION);
    expect(h.get('x-forwarded-for')).toBe('203.0.113.7');

    // Respuesta: pasa, el navegador recibe la cookie nueva y los Server Components de esta petición ya la ven.
    expect(destino(r)).toBeNull();
    expect(r.cookies.get('token_consultorio')).toMatchObject({ value: nuevo, httpOnly: true, sameSite: 'lax', maxAge: 900 });
    expect(r.headers.get('x-middleware-request-cookie')).toContain(`token_consultorio=${nuevo}`);
  });

  test('sin token también pide uno', async () => {
    const nuevo = tokenQueVence(new Date(), 900);
    fetchFalso.mockResolvedValue(respuestaJson(200, { token: nuevo }));

    const r = await proxy(peticion('/agenda', [SESION, `consultorio_id=${CONSULTORIO}`]));

    expect(fetchFalso).toHaveBeenCalledOnce();
    expect(r.cookies.get('token_consultorio')?.value).toBe(nuevo);
  });

  test('Review Focus 4: proxy con sesión vencida (401) redirige a /login y borra cookies', async () => {
    fetchFalso.mockResolvedValue(respuestaJson(401, { code: 'NO_AUTENTICADO', message: 'Sesión inválida' }));

    const r = await proxy(
      peticion('/agenda', [SESION, 'better-auth.two_factor=t', `consultorio_id=${CONSULTORIO}`, 'token_consultorio=viejo', 'tema=oscuro']),
    );

    expect(destino(r)).toBe('http://localhost:3000/login');
    const borradas = r.cookies
      .getAll()
      .filter((x) => x.value === '' && x.maxAge === 0)
      .map((x) => x.name)
      .sort();
    expect(borradas).toEqual(['better-auth.session_token', 'better-auth.two_factor', 'consultorio_id', 'token_consultorio']);
  });

  test.each([
    ['PASSWORD_TEMPORAL', '/cambiar-password'],
    ['MFA_REQUERIDA', '/configurar-mfa'],
  ])('403 %s → %s y conserva la sesión', async (code, ruta) => {
    fetchFalso.mockResolvedValue(respuestaJson(403, { code, message: '' }));

    const r = await proxy(peticion('/agenda', [SESION, `consultorio_id=${CONSULTORIO}`]));

    expect(destino(r)).toBe(`http://localhost:3000${ruta}`);
    expect(r.cookies.getAll()).toEqual([]);
  });

  test('403 PROHIBIDO (ya no es miembro) → /sin-acceso y olvida el consultorio', async () => {
    fetchFalso.mockResolvedValue(respuestaJson(403, { code: 'PROHIBIDO', message: '' }));

    const r = await proxy(peticion('/agenda', [SESION, `consultorio_id=${CONSULTORIO}`, 'token_consultorio=viejo']));

    expect(destino(r)).toBe('http://localhost:3000/sin-acceso');
    expect(
      r.cookies
        .getAll()
        .map((x) => x.name)
        .sort(),
    ).toEqual(['consultorio_id', 'token_consultorio']);
  });

  test.each([
    [400, 'VALIDACION'],
    [404, 'NO_ENCONTRADO'],
  ])('%i %s (consultorio_id inválido o inexistente) → /elegir-consultorio y olvida el consultorio', async (status, code) => {
    fetchFalso.mockResolvedValue(respuestaJson(status, { code, message: '' }));

    const r = await proxy(peticion('/agenda', [SESION, 'consultorio_id=no-es-uuid', 'token_consultorio=viejo']));

    expect(destino(r)).toBe('http://localhost:3000/elegir-consultorio');
    expect(
      r.cookies
        .getAll()
        .filter((x) => x.value === '' && x.maxAge === 0)
        .map((x) => x.name)
        .sort(),
    ).toEqual(['consultorio_id', 'token_consultorio']);
  });

  test('las cookies __Secure- se borran con Secure aunque COOKIE_SEGURA no esté', async () => {
    fetchFalso.mockResolvedValue(respuestaJson(401, { code: 'NO_AUTENTICADO', message: '' }));

    const r = await proxy(peticion('/agenda', ['__Secure-better-auth.session_token=s', `consultorio_id=${CONSULTORIO}`]));

    expect(r.cookies.get('__Secure-better-auth.session_token')).toMatchObject({ value: '', maxAge: 0, secure: true });
    expect(r.cookies.get('consultorio_id')).toMatchObject({ value: '', maxAge: 0, secure: false });
  });

  test('gateway caído (503) → deja pasar; la pantalla muestra el aviso genérico', async () => {
    fetchFalso.mockRejectedValue(new TypeError('fetch failed'));

    const r = await proxy(peticion('/agenda', [SESION, `consultorio_id=${CONSULTORIO}`]));

    expect(destino(r)).toBeNull();
    expect(r.cookies.getAll()).toEqual([]);
  });
});
