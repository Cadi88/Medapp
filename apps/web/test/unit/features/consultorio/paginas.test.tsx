// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ obtenerContexto: vi.fn(), obtenerConfig: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/sesion/contexto', () => ({ obtenerContexto: m.obtenerContexto }));
vi.mock('@/features/consultorio/actions', () => ({}));
vi.mock('@/features/recordatorios/api', () => ({ obtenerConfig: m.obtenerConfig }));

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
const configRecordatorios = {
  modo: 'con_revision',
  horaEnvio: '10:00',
  plantillas: { correoAsunto: 'Recordatorio de tu cita', correoCuerpo: 'Hola {paciente}', whatsapp: 'Hola {paciente}' },
};
const contexto = (admin: boolean, c = consultorio) => ({ claims: { sub: 'u1', tid: 't1', rol: 'recepcion', admin, mfa: true }, consultorio: c });

beforeEach(() => vi.clearAllMocks());

describe('página /consultorio', () => {
  test('página /consultorio sin admin → /sin-acceso', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(false));
    await expect(ConsultorioPage()).rejects.toThrow('REDIRECT:/sin-acceso');
  });

  test('con admin muestra el formulario con los datos actuales y la sección Recordatorios', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(true));
    m.obtenerConfig.mockResolvedValue(exito(configRecordatorios));
    const el = (await ConsultorioPage()) as ReactElement;
    expect(isValidElement(el)).toBe(true);
    expect(JSON.stringify(el)).toContain('Mi consultorio');
    expect(JSON.stringify(el)).toContain('"consultorio":"Sonrisas"');
    expect(JSON.stringify(el)).toContain('Recordatorio de tu cita');
  });

  test('si no se puede leer la configuración de recordatorios, va a la frontera de error; sin sesión desvía', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(true));
    m.obtenerConfig.mockResolvedValueOnce(fallo(503, { code: 'INTERNO', message: 'x' } as never));
    await expect(ConsultorioPage()).rejects.toThrow('No se pudo cargar los recordatorios (503)');
    m.obtenerConfig.mockResolvedValueOnce(fallo(401, { code: 'NO_AUTENTICADO', message: 'x' } as never));
    await expect(ConsultorioPage()).rejects.toThrow('REDIRECT:/login');
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
