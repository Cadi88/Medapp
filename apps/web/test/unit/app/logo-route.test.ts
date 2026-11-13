// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ llamarGateway: vi.fn(), leerToken: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '9.9.9.9' }) }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/sesion/cookies', () => ({ leerToken: m.leerToken }));
vi.mock('@/lib/api/gateway', () => ({ llamarGateway: m.llamarGateway, ipDelCliente: (h: Headers) => h.get('x-forwarded-for') ?? undefined }));

const { GET } = await import('@/app/consultorio/logo/route');

const PNG = new Uint8Array([137, 80, 78, 71]);
const error = { code: 'INTERNO', message: 'x' } as never;

beforeEach(() => {
  m.llamarGateway.mockReset();
  m.leerToken.mockReset();
  m.leerToken.mockResolvedValue('jwt');
});

describe('GET /consultorio/logo', () => {
  test('200 → reenvía los bytes como image/png con caché privada', async () => {
    m.llamarGateway.mockResolvedValue(exito({ bytes: PNG, tipo: 'image/png', cabeceras: new Headers() }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  test('Review Focus 4: usa el token de la sesión e ignora parámetros', async () => {
    m.llamarGateway.mockResolvedValue(exito({ bytes: PNG, tipo: 'image/png', cabeceras: new Headers() }));
    // El manejador no lee la URL: `?tenant=otro` no puede cambiar a qué consultorio se pide el logo.
    await (GET as (r?: Request) => Promise<Response>)(new Request('http://web/consultorio/logo?tenant=otro&v=3'));
    expect(m.llamarGateway).toHaveBeenCalledTimes(1);
    expect(m.llamarGateway).toHaveBeenCalledWith(
      '/api/identidad/consultorio/logo',
      expect.objectContaining({ auth: 'token', respuestaBinaria: true, ip: '9.9.9.9' }),
    );
  });

  test('404 → 404; cualquier otro error → 503', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(404, error));
    expect((await GET()).status).toBe(404);
    m.llamarGateway.mockResolvedValueOnce(fallo(503, error));
    expect((await GET()).status).toBe(503);
    m.llamarGateway.mockResolvedValueOnce(fallo(500, error));
    expect((await GET()).status).toBe(503);
  });

  test('sin sesión → redirect /login sin llamar al gateway', async () => {
    m.leerToken.mockResolvedValue(undefined);
    await expect(GET()).rejects.toThrow('REDIRECT:/login');
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });
});
