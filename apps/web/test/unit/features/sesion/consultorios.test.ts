// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ llamarGateway: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));
vi.mock('@/lib/api/gateway', () => ({ llamarGateway: m.llamarGateway, ipDelCliente: () => undefined }));

const { consultoriosParaElegir } = await import('@/features/sesion/consultorios');

const mio = { tenantId: '0190a0a0-0000-7000-8000-000000000001', nombre: 'A', slug: 'a', rol: 'medico', admin: true };

beforeEach(() => m.llamarGateway.mockReset());

describe('consultoriosParaElegir', () => {
  test('devuelve la lista', async () => {
    m.llamarGateway.mockResolvedValue(exito([mio]));
    expect(await consultoriosParaElegir()).toEqual([mio]);
  });

  test('sin consultorios → /sin-acceso; sin sesión → /login', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito([]));
    await expect(consultoriosParaElegir()).rejects.toThrow('REDIRECT:/sin-acceso');
    m.llamarGateway.mockResolvedValueOnce(fallo(401, { code: 'NO_AUTENTICADO', message: 'x' }));
    await expect(consultoriosParaElegir()).rejects.toThrow('REDIRECT:/login');
  });

  test('otro error lo lanza para la frontera de error', async () => {
    m.llamarGateway.mockResolvedValue(fallo(503, { code: 'INTERNO', message: 'No se pudo contactar al servidor' }));
    await expect(consultoriosParaElegir()).rejects.toThrow('No se pudo contactar al servidor');
  });
});
