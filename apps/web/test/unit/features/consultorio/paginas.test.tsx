// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';

const m = vi.hoisted(() => ({ obtenerContexto: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/sesion/contexto', () => ({ obtenerContexto: m.obtenerContexto }));
vi.mock('@/features/consultorio/actions', () => ({}));

const { default: ConsultorioPage } = await import('@/app/(app)/consultorio/page');
const { default: AppLayout } = await import('@/app/(app)/layout');

const consultorio = {
  id: 't1',
  nombre: 'Dental Sol',
  slug: 'dental-sol',
  zonaHoraria: 'America/Mexico_City',
  nombreComercial: 'Sonrisas',
  direccion: null,
  telefono: null,
  colorPrimario: '#1d4ed8',
  colorTexto: '#ffffff',
  logoVersion: 2,
  pais: 'MX',
  moneda: 'MXN',
};
const contexto = (admin: boolean, c = consultorio) => ({ claims: { sub: 'u1', tid: 't1', rol: 'recepcion', admin, mfa: true }, consultorio: c });

beforeEach(() => vi.clearAllMocks());

describe('página /consultorio', () => {
  test('página /consultorio sin admin → /sin-acceso', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(false));
    await expect(ConsultorioPage()).rejects.toThrow('REDIRECT:/sin-acceso');
  });

  test('con admin muestra el formulario con los datos actuales', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(true));
    const el = (await ConsultorioPage()) as ReactElement;
    expect(isValidElement(el)).toBe(true);
    expect(JSON.stringify(el)).toContain('Mi consultorio');
  });
});

describe('layout de (app)', () => {
  const estilo = (el: ReactElement) => (el.props as { style?: Record<string, string> }).style;

  test('con color del consultorio pone --primary y --primary-foreground en el contenedor raíz', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(false));
    const el = (await AppLayout({ children: null })) as ReactElement;
    expect(estilo(el)).toEqual({ '--primary': '#1d4ed8', '--primary-foreground': '#ffffff' });
  });

  test('sin color no pone variables', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(false, { ...consultorio, colorPrimario: null, colorTexto: null } as unknown as typeof consultorio));
    const el = (await AppLayout({ children: null })) as ReactElement;
    expect(estilo(el)).toEqual({});
  });

  test('el encabezado muestra nombreComercial ?? nombre y el logoVersion', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(false));
    const raiz = (await AppLayout({ children: null })) as ReactElement;
    const [barra] = (raiz.props as { children: ReactElement[] }).children;
    expect((barra as ReactElement).props).toMatchObject({ consultorio: 'Sonrisas', logoVersion: 2 });

    m.obtenerContexto.mockResolvedValue(contexto(false, { ...consultorio, nombreComercial: null } as unknown as typeof consultorio));
    const raiz2 = (await AppLayout({ children: null })) as ReactElement;
    const [barra2] = (raiz2.props as { children: ReactElement[] }).children;
    expect((barra2 as ReactElement).props).toMatchObject({ consultorio: 'Dental Sol' });
  });
});
