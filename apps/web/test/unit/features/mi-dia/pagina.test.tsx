// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ obtenerContexto: vi.fn(), listarCitas: vi.fn(), listarMedicos: vi.fn(), listarTiposCita: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/sesion/contexto', () => ({ obtenerContexto: m.obtenerContexto }));
vi.mock('@/features/agenda/api', () => ({ listarCitas: m.listarCitas, listarMedicos: m.listarMedicos, listarTiposCita: m.listarTiposCita }));

const { default: MiDiaPage } = await import('@/app/(app)/mi-dia/page');

const MEDICO = '0190a0a0-0000-7000-8000-00000000000a';
const OTRO = '0190a0a0-0000-7000-8000-00000000000c';
const consultorio = { zonaHoraria: 'America/Mexico_City' };
const contexto = (rol: 'medico' | 'recepcion', admin: boolean, sub = MEDICO) => ({ claims: { sub, tid: 't', rol, admin, mfa: true }, consultorio });
const medicos = [
  { usuarioId: MEDICO, nombre: 'Dra. Ruiz' },
  { usuarioId: OTRO, nombre: 'Dr. Soto' },
];
const buscarProps = (el: ReactElement, nombre: string): Record<string, unknown> | undefined => {
  const visitar = (nodo: unknown): Record<string, unknown> | undefined => {
    if (Array.isArray(nodo)) return nodo.map(visitar).find(Boolean);
    if (!isValidElement(nodo)) return undefined;
    const e = nodo as ReactElement<Record<string, unknown>>;
    if ((e.type as { name?: string }).name === nombre) return e.props;
    return visitar(e.props.children);
  };
  return visitar(el);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // 2026-11-15 12:00 en Ciudad de México
  vi.setSystemTime(new Date('2026-11-15T18:00:00Z'));
  m.listarCitas.mockResolvedValue(exito([]));
  m.listarMedicos.mockResolvedValue(exito(medicos));
  m.listarTiposCita.mockResolvedValue(exito([]));
});

describe('página /mi-dia', () => {
  test('un médico ve solo sus citas: pide hoy y 7 días en la zona del consultorio con su propio id', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('medico', false));
    const el = (await MiDiaPage({ searchParams: Promise.resolve({ medico: OTRO }) })) as ReactElement;
    // `?medico=` se ignora para un médico sin admin
    expect(m.listarCitas).toHaveBeenCalledWith('2026-11-15T06:00:00.000Z', '2026-11-23T06:00:00.000Z', MEDICO);
    expect(m.listarMedicos).not.toHaveBeenCalled();
    expect(buscarProps(el, 'SelectorMedico')).toBeUndefined();
    expect(buscarProps(el, 'MiDia')).toMatchObject({ zona: 'America/Mexico_City', hoy: '2026-11-15' });
  });

  test('admin que es médico empieza con sus propias citas y puede elegir otro', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('medico', true));
    const el = (await MiDiaPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(m.listarCitas).toHaveBeenCalledWith(expect.any(String), expect.any(String), MEDICO);
    expect(buscarProps(el, 'SelectorMedico')).toMatchObject({ valor: MEDICO });
  });

  test('recepción elige médico con ?medico=', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('recepcion', false, 'recep'));
    await MiDiaPage({ searchParams: Promise.resolve({ medico: OTRO }) });
    expect(m.listarCitas).toHaveBeenCalledWith(expect.any(String), expect.any(String), OTRO);
  });

  test('recepción sin elegir: pide elegir y no consulta citas', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('recepcion', false, 'recep'));
    const el = (await MiDiaPage({ searchParams: Promise.resolve({}) })) as ReactElement;
    expect(m.listarCitas).not.toHaveBeenCalled();
    expect(JSON.stringify(el)).toContain('Elige un médico para ver su día');
  });

  test('un médico que no está en la lista se trata como no elegido', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('recepcion', false, 'recep'));
    await MiDiaPage({ searchParams: Promise.resolve({ medico: 'no-existe' }) });
    expect(m.listarCitas).not.toHaveBeenCalled();
  });

  test('sesión vencida desvía; otro error va a la frontera de error', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('medico', false));
    m.listarCitas.mockResolvedValueOnce(fallo(401, { code: 'NO_AUTENTICADO', message: 'x' }));
    await expect(MiDiaPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/login');
    m.listarCitas.mockResolvedValueOnce(fallo(500, { code: 'INTERNO', message: 'x' }));
    await expect(MiDiaPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('No se pudo cargar Mi día (500)');
  });
});
