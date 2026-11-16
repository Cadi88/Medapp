// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { exito, fallo } from '@/lib/api/resultado';
import { recordatorio } from './apoyo';

const m = vi.hoisted(() => ({ obtenerContexto: vi.fn(), listarRecordatorios: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/sesion/contexto', () => ({ obtenerContexto: m.obtenerContexto }));
vi.mock('@/features/recordatorios/api', () => ({ listarRecordatorios: m.listarRecordatorios }));
vi.mock('@/features/recordatorios/actions', () => ({}));

const { default: RecordatoriosPage } = await import('@/app/(app)/recordatorios/page');

const contexto = (rol: 'medico' | 'recepcion', admin: boolean) => ({
  claims: { sub: 'u1', tid: 't', rol, admin, mfa: true },
  consultorio: { zonaHoraria: 'America/Mexico_City' },
});
const propsDelPanel = (el: ReactElement): Record<string, unknown> | undefined => {
  const visitar = (nodo: unknown): Record<string, unknown> | undefined => {
    if (Array.isArray(nodo)) return nodo.map(visitar).find(Boolean);
    if (!isValidElement(nodo)) return undefined;
    const e = nodo as ReactElement<Record<string, unknown>>;
    if ((e.type as { name?: string }).name === 'PanelRecordatorios') return e.props;
    return visitar(e.props.children);
  };
  return visitar(el);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // 2026-11-15 12:00 en Ciudad de México → mañana es el 16
  vi.setSystemTime(new Date('2026-11-15T18:00:00Z'));
});

describe('página /recordatorios', () => {
  test('un médico sin admin → /sin-acceso', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('medico', false));
    await expect(RecordatoriosPage()).rejects.toThrow('REDIRECT:/sin-acceso');
    expect(m.listarRecordatorios).not.toHaveBeenCalled();
  });

  test.each([
    ['recepción', 'recepcion', false],
    ['admin médico', 'medico', true],
  ] as const)('%s pide mañana y los dos días siguientes', async (_n, rol, admin) => {
    m.obtenerContexto.mockResolvedValue(contexto(rol, admin));
    m.listarRecordatorios.mockResolvedValue(exito({ modo: 'con_revision', horaEnvio: '10:00', citas: [recordatorio()] }));
    const el = (await RecordatoriosPage()) as ReactElement;
    expect(m.listarRecordatorios).toHaveBeenCalledWith('2026-11-16', '2026-11-18');
    expect(propsDelPanel(el)).toMatchObject({ desde: '2026-11-16', hasta: '2026-11-18', zona: 'America/Mexico_City' });
  });

  test('sesión vencida desvía; otro error va a la frontera de error', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('recepcion', false));
    m.listarRecordatorios.mockResolvedValueOnce(fallo(401, { code: 'NO_AUTENTICADO', message: 'x' }));
    await expect(RecordatoriosPage()).rejects.toThrow('REDIRECT:/login');
    m.listarRecordatorios.mockResolvedValueOnce(fallo(503, { code: 'INTERNO', message: 'x' }));
    await expect(RecordatoriosPage()).rejects.toThrow('No se pudo cargar los recordatorios (503)');
  });
});
