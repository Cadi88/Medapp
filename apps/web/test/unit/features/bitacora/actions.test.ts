// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ llamarGateway: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/api/gateway', () => ({ llamarGateway: m.llamarGateway, ipDelCliente: () => undefined }));

const { cargarMasEventos } = await import('@/features/bitacora/actions');
const { listarEventos } = await import('@/features/bitacora/api');

const fila = {
  id: 'e1',
  tenant_id: 't1',
  secuencia: '42',
  ocurrido_en: '2026-11-12T16:00:00.000Z',
  actor_id: null,
  accion: 'tenant.creado',
  recurso_tipo: 'tenant',
  recurso_id: 't1',
  servicio: 'svc-identidad',
  detalle: { x: 1 },
  hash_anterior: null,
  hash: 'abc',
};

beforeEach(() => m.llamarGateway.mockReset());

describe('listarEventos', () => {
  test('arma la query solo con los filtros presentes y valida las filas en snake_case', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ eventos: [fila], siguiente: 42 }));
    const r = await listarEventos({ accion: 'cita.creada', antesDe: 50 });
    const [ruta, o] = m.llamarGateway.mock.calls[0] ?? [];
    expect(ruta).toBe('/api/auditoria/eventos?accion=cita.creada&antesDe=50');
    expect(o).toMatchObject({ auth: 'token' });
    const esquema = (o as { esquema: { parse: (x: unknown) => unknown } }).esquema;
    expect(esquema.parse({ eventos: [{ ...fila, secuencia: 42 }], siguiente: null })).toMatchObject({ eventos: [{ secuencia: '42' }] });
    expect(r.ok).toBe(true);
  });

  test('sin filtros no agrega query', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ eventos: [], siguiente: null }));
    await listarEventos({});
    expect(m.llamarGateway.mock.calls[0]?.[0]).toBe('/api/auditoria/eventos');
  });
});

describe('cargarMasEventos', () => {
  test('devuelve los eventos y el cursor', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ eventos: [fila], siguiente: 40 }));
    const r = await cargarMasEventos({ desde: '2026-11-12T06:00:00.000Z' }, 42);
    expect(r).toMatchObject({ ok: true, siguiente: 40 });
    expect(m.llamarGateway.mock.calls[0]?.[0]).toBe('/api/auditoria/eventos?desde=2026-11-12T06%3A00%3A00.000Z&antesDe=42');
  });

  test('parámetros inválidos no llaman al gateway', async () => {
    expect(await cargarMasEventos({ accion: 'x y' }, 42)).toEqual({ ok: false, mensaje: 'Revisa los datos del formulario' });
    expect(await cargarMasEventos({}, -1)).toMatchObject({ ok: false });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('errores de la API: mensaje genérico; sin permiso, desvío', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(500, { code: 'INTERNO', message: 'detalle interno' }));
    expect(await cargarMasEventos({}, 5)).toEqual({ ok: false, mensaje: 'Ocurrió un error. Intenta de nuevo.' });
    m.llamarGateway.mockResolvedValueOnce(fallo(403, { code: 'PROHIBIDO', message: 'x' }));
    await expect(cargarMasEventos({}, 5)).rejects.toThrow('REDIRECT:/sin-acceso');
  });
});
