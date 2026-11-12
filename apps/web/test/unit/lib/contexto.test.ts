// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { crearAlmacenCookies } from '../apoyo/cookies-falsas.js';
import { CLAIMS, tokenQueVence } from '../apoyo/jwt.js';

const falsas = vi.hoisted(() => ({ ref: undefined as unknown }));
vi.mock('next/headers', () => ({
  cookies: async () => falsas.ref,
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (ruta: string) => {
    throw new Error(`REDIRECT:${ruta}`);
  },
}));

const { obtenerContexto } = await import('@/lib/sesion/contexto');

const c = crearAlmacenCookies();
falsas.ref = c.almacen;
const fetchFalso = vi.fn<typeof fetch>();
const consultorio = { id: CLAIMS.tid, nombre: 'Consultorio Centro', slug: 'centro', zonaHoraria: 'America/Mexico_City' };

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

describe('obtenerContexto', () => {
  test('devuelve los claims del token y el consultorio del gateway', async () => {
    const token = tokenQueVence(new Date(), 900);
    c.poner('token_consultorio', token);
    fetchFalso.mockResolvedValue(new Response(JSON.stringify(consultorio), { status: 200 }));

    expect(await obtenerContexto()).toEqual({ claims: CLAIMS, consultorio });
    const [url, init = {}] = fetchFalso.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://gateway:8080/api/identidad/consultorio');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`);
    expect(new Headers(init.headers).get('x-forwarded-for')).toBe('203.0.113.7');
  });

  test('sin token (la renovación del proxy falló sin desvío) → error a la frontera de error, no /login', async () => {
    // La sesión puede seguir vigente: mandar a /login la dejaría en un ciclo cuando /login reenvíe a usuarios con sesión.
    await expect(obtenerContexto()).rejects.toThrow('Sin token del consultorio');
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  test('error con desvío (403 PROHIBIDO) → redirige', async () => {
    c.poner('token_consultorio', tokenQueVence(new Date(), 900));
    fetchFalso.mockResolvedValue(new Response(JSON.stringify({ code: 'PROHIBIDO', message: '' }), { status: 403 }));

    await expect(obtenerContexto()).rejects.toThrow('REDIRECT:/sin-acceso');
  });

  test('error sin desvío (gateway caído) → lanza para que lo muestre la frontera de error', async () => {
    c.poner('token_consultorio', tokenQueVence(new Date(), 900));
    fetchFalso.mockRejectedValue(new TypeError('fetch failed'));

    await expect(obtenerContexto()).rejects.toThrow('No se pudo cargar el consultorio (503)');
  });
});
