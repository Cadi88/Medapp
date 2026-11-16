// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ obtenerEnlacePublico: vi.fn(), registrarRespuestaEnApi: vi.fn() }));
vi.mock('@/features/respuesta/api', () => ({ obtenerEnlacePublico: m.obtenerEnlacePublico, registrarRespuestaEnApi: m.registrarRespuestaEnApi }));
vi.mock('@/features/respuesta/actions', () => ({}));

const { default: RespuestaPage, metadata } = await import('@/app/r/[token]/page');

const TOKEN = 'abc_DEF-123';
const buscar = (nodo: unknown, nombre: string): Record<string, unknown> | undefined => {
  if (Array.isArray(nodo)) return nodo.map((n) => buscar(n, nombre)).find(Boolean);
  if (!isValidElement(nodo)) return undefined;
  const e = nodo as ReactElement<Record<string, unknown>>;
  if ((e.type as { name?: string }).name === nombre) return e.props;
  return buscar(e.props.children, nombre);
};

beforeEach(() => vi.clearAllMocks());

describe('página pública /r/[token]', () => {
  test('Review Focus 4: ?accion=cancela solo preselecciona; sin clic no se registra nada', async () => {
    m.obtenerEnlacePublico.mockResolvedValue(exito({ estado: 'vigente', consultorio: { nombre: 'Dental Sol', tieneLogo: false } }));
    const el = (await RespuestaPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({ accion: 'cancela' }) })) as ReactElement;
    expect(buscar(el, 'PaginaRespuesta')).toMatchObject({ token: TOKEN, accion: 'cancela' });
    expect(m.obtenerEnlacePublico).toHaveBeenCalledWith(TOKEN);
    expect(m.registrarRespuestaEnApi).not.toHaveBeenCalled();
  });

  test('un ?accion desconocido no preselecciona nada', async () => {
    m.obtenerEnlacePublico.mockResolvedValue(exito({ estado: 'invalida' }));
    const el = (await RespuestaPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({ accion: 'borrar' }) })) as ReactElement;
    expect(buscar(el, 'PaginaRespuesta')?.accion).toBeUndefined();
  });

  test('si el servicio no responde muestra un aviso sin decir nada del enlace', async () => {
    m.obtenerEnlacePublico.mockResolvedValue(fallo(503, { code: 'INTERNO', message: 'x' } as never));
    const el = (await RespuestaPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({}) })) as ReactElement;
    expect(buscar(el, 'PaginaRespuesta')).toBeUndefined();
    expect(JSON.stringify(el)).toContain('No pudimos cargar tu cita');
  });

  test('no se indexa ni manda el enlace como referencia', () => {
    expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: 'no-referrer' });
  });
});
