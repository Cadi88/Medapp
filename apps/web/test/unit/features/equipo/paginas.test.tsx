// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ obtenerContexto: vi.fn(), listarMiembros: vi.fn(), listarEventos: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/sesion/contexto', () => ({ obtenerContexto: m.obtenerContexto }));
vi.mock('@/features/equipo/api', () => ({ listarMiembros: m.listarMiembros }));
vi.mock('@/features/bitacora/api', () => ({ listarEventos: m.listarEventos }));
vi.mock('@/features/equipo/actions', () => ({}));
vi.mock('@/features/bitacora/actions', () => ({}));

const { default: EquipoPage } = await import('@/app/(app)/equipo/page');
const { default: BitacoraPage } = await import('@/app/(app)/bitacora/page');

const contexto = (admin: boolean) => ({
  claims: { sub: 'u1', tid: 't1', rol: 'recepcion', admin, mfa: true },
  consultorio: { id: 't1', nombre: 'Centro', slug: 'centro', zonaHoraria: 'America/Mexico_City' },
});

beforeEach(() => vi.clearAllMocks());

describe('páginas solo de administración', () => {
  test('página de equipo sin admin → redirect /sin-acceso', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(false));
    await expect(EquipoPage()).rejects.toThrow('REDIRECT:/sin-acceso');
    expect(m.listarMiembros).not.toHaveBeenCalled();
  });

  test('página de bitácora sin admin → redirect /sin-acceso', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(false));
    await expect(BitacoraPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/sin-acceso');
    expect(m.listarEventos).not.toHaveBeenCalled();
  });

  test('con admin, equipo carga los miembros', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(true));
    m.listarMiembros.mockResolvedValue(exito([]));
    await expect(EquipoPage()).resolves.toBeTruthy();
  });

  test('con admin, bitácora filtra por días del consultorio y resuelve nombres con los miembros', async () => {
    m.obtenerContexto.mockResolvedValue(contexto(true));
    m.listarEventos.mockResolvedValue(exito({ eventos: [], siguiente: null }));
    m.listarMiembros.mockResolvedValue(exito([]));
    await expect(BitacoraPage({ searchParams: Promise.resolve({ desde: '2026-11-12', accion: 'cita.creada' }) })).resolves.toBeTruthy();
    expect(m.listarEventos).toHaveBeenCalledWith({ desde: '2026-11-12T06:00:00.000Z', accion: 'cita.creada' });
    expect(m.listarMiembros).toHaveBeenCalled();
  });
});
