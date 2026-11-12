// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({
  obtenerContexto: vi.fn(),
  listarMedicos: vi.fn(),
  listarTiposCita: vi.fn(),
  leerHorario: vi.fn(),
  listarBloqueosDesde: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/sesion/contexto', () => ({ obtenerContexto: m.obtenerContexto }));
vi.mock('@/features/agenda/api', () => ({ listarMedicos: m.listarMedicos, listarTiposCita: m.listarTiposCita }));
vi.mock('@/features/medicos/api', () => ({ leerHorario: m.leerHorario, listarBloqueosDesde: m.listarBloqueosDesde }));
vi.mock('@/features/medicos/actions', () => ({}));

const { default: MedicosPage } = await import('@/app/(app)/medicos/page');
const { default: MedicoPage } = await import('@/app/(app)/medicos/[id]/page');

const MEDICO = '0190a0a0-0000-7000-8000-00000000000a';
const contexto = (rol: 'medico' | 'recepcion', admin: boolean) => ({
  claims: { sub: MEDICO, tid: 't1', rol, admin, mfa: true },
  consultorio: { id: 't1', nombre: 'Centro', slug: 'centro', zonaHoraria: 'America/Mexico_City' },
});

beforeEach(() => vi.resetAllMocks());

describe('/medicos', () => {
  test('un médico sin admin va a su propia página', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('medico', false));
    await expect(MedicosPage()).rejects.toThrow(`REDIRECT:/medicos/${MEDICO}`);
    expect(m.listarMedicos).not.toHaveBeenCalled();
  });

  test.each([
    ['recepción', 'recepcion', false],
    ['admin', 'medico', true],
  ] as const)('%s ve la lista', async (_n, rol, admin) => {
    m.obtenerContexto.mockResolvedValue(contexto(rol, admin));
    m.listarMedicos.mockResolvedValue(exito([{ usuarioId: MEDICO, nombre: 'Dra. Ruiz' }]));
    await expect(MedicosPage()).resolves.toBeTruthy();
    expect(m.listarMedicos).toHaveBeenCalled();
  });
});

describe('/medicos/[id]', () => {
  const props = (id: string) => ({ params: Promise.resolve({ id }) });

  test('carga horario, tipos (todos) y bloqueos futuros del médico', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('recepcion', false));
    m.listarMedicos.mockResolvedValue(exito([{ usuarioId: MEDICO, nombre: 'Dra. Ruiz' }]));
    m.leerHorario.mockResolvedValue(exito([]));
    m.listarTiposCita.mockResolvedValue(exito([]));
    m.listarBloqueosDesde.mockResolvedValue(exito([]));
    await expect(MedicoPage(props(MEDICO))).resolves.toBeTruthy();
    expect(m.listarTiposCita).toHaveBeenCalledWith(MEDICO, true);
    expect(m.listarBloqueosDesde).toHaveBeenCalledWith(MEDICO, expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  test('un médico que no está en la lista da 404', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('recepcion', false));
    m.listarMedicos.mockResolvedValue(exito([]));
    await expect(MedicoPage(props(MEDICO))).rejects.toThrow('NOT_FOUND');
  });

  test('un id que no es uuid da 404 sin llamar a la API', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('recepcion', false));
    await expect(MedicoPage(props('abc'))).rejects.toThrow('NOT_FOUND');
    expect(m.listarMedicos).not.toHaveBeenCalled();
  });

  test('un fallo de la API que no es de acceso va a la frontera de error; sin permiso, a /sin-acceso', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('recepcion', false));
    m.listarMedicos.mockResolvedValue(exito([{ usuarioId: MEDICO, nombre: 'Dra. Ruiz' }]));
    m.leerHorario.mockResolvedValue(fallo(500, { code: 'INTERNO', message: 'x' }));
    m.listarTiposCita.mockResolvedValue(exito([]));
    m.listarBloqueosDesde.mockResolvedValue(exito([]));
    await expect(MedicoPage(props(MEDICO))).rejects.toThrow('No se pudo cargar el horario (500)');
    m.leerHorario.mockResolvedValue(fallo(403, { code: 'PROHIBIDO', message: 'x' }));
    await expect(MedicoPage(props(MEDICO))).rejects.toThrow('REDIRECT:/sin-acceso');
  });
});
