import '@testing-library/jest-dom/vitest';
import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { rangoDeMiDia, separarCitas } from '@/features/mi-dia/logica/mi-dia';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { MiDia } = await import('@/features/mi-dia/components/MiDia');
const { SelectorMedico } = await import('@/features/mi-dia/components/SelectorMedico');

const ZONA = 'America/Mexico_City';
const MEDICO = '0190a0a0-0000-7000-8000-00000000000a';
const OTRO = '0190a0a0-0000-7000-8000-00000000000c';
const TIPO = '0190a0a0-0000-7000-8000-00000000000b';
const tipos: TipoCita[] = [{ id: TIPO, medicoId: MEDICO, nombre: 'Consulta', duracionMin: 30, activo: true }];
const medicos: MedicoAgenda[] = [
  { usuarioId: MEDICO, nombre: 'Dra. Ruiz' },
  { usuarioId: OTRO, nombre: 'Dr. Soto' },
];

let n = 0;
const cita = (extra: Partial<Cita> = {}): Cita => ({
  id: `0190a0a0-0000-7000-8000-0000000001${String(++n).padStart(2, '0')}`,
  medicoId: MEDICO,
  tipoCitaId: TIPO,
  // 16:00Z = 10:00 en Ciudad de México
  inicio: '2026-11-15T16:00:00.000Z',
  fin: '2026-11-15T16:30:00.000Z',
  estado: 'agendada',
  contacto: { nombre: 'Ana Pérez', telefono: '5551234567' },
  fueraDeHorario: false,
  pideCambio: false,
  version: 1,
  ...extra,
});

describe('rangoDeMiDia', () => {
  test('hoy a las 00:00 de la zona del consultorio hasta 8 días después', () => {
    // 2026-11-15 03:00Z todavía es el 14 en Ciudad de México
    expect(rangoDeMiDia(new Date('2026-11-15T03:00:00Z'), ZONA)).toEqual({
      hoy: '2026-11-14',
      desde: '2026-11-14T06:00:00.000Z',
      hasta: '2026-11-22T06:00:00.000Z',
    });
  });
});

describe('separarCitas', () => {
  test('hoy en orden con cualquier estado; próximos días solo agendadas, en orden', () => {
    const hoyTarde = cita({ inicio: '2026-11-15T20:00:00.000Z', fin: '2026-11-15T20:30:00.000Z', estado: 'confirmada' });
    const hoyTemprano = cita({ inicio: '2026-11-15T15:00:00.000Z', fin: '2026-11-15T15:30:00.000Z', estado: 'atendida' });
    // 2026-11-16 05:30Z = 23:30 del día 15 local: sigue siendo hoy
    const hoyNoche = cita({ inicio: '2026-11-16T05:30:00.000Z', fin: '2026-11-16T06:00:00.000Z' });
    const mañana = cita({ inicio: '2026-11-16T16:00:00.000Z', fin: '2026-11-16T16:30:00.000Z' });
    const mañanaConfirmada = cita({ inicio: '2026-11-16T17:00:00.000Z', fin: '2026-11-16T17:30:00.000Z', estado: 'confirmada' });
    const pasado = cita({ inicio: '2026-11-17T16:00:00.000Z', fin: '2026-11-17T16:30:00.000Z' });
    const r = separarCitas([pasado, mañanaConfirmada, hoyTarde, mañana, hoyNoche, hoyTemprano], '2026-11-15', ZONA);
    expect(r.hoy.map((c) => c.id)).toEqual([hoyTemprano.id, hoyTarde.id, hoyNoche.id]);
    expect(r.proximas.map((c) => c.id)).toEqual([mañana.id, pasado.id]);
  });
});

describe('MiDia', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  test('hoy con hora, estado, tipo y "Pide cambio"; abajo las agendadas de los próximos días', () => {
    const hoy = cita({ pideCambio: true, estado: 'confirmada' });
    const proxima = cita({ inicio: '2026-11-17T17:00:00.000Z', fin: '2026-11-17T17:30:00.000Z', contacto: { nombre: 'Luis Gómez', telefono: '5550000000' } });
    render(<MiDia citas={[proxima, hoy]} tipos={tipos} zona={ZONA} hoy="2026-11-15" />);
    const secHoy = screen.getByRole('region', { name: 'Hoy' });
    expect(within(secHoy).getByText('Ana Pérez')).toBeInTheDocument();
    expect(within(secHoy).getByText('10:00')).toBeInTheDocument();
    expect(within(secHoy).getByText('Confirmada')).toBeInTheDocument();
    expect(within(secHoy).getByText('Pide cambio')).toBeInTheDocument();
    expect(within(secHoy).getByText('Consulta')).toBeInTheDocument();
    const secProx = screen.getByRole('region', { name: 'Próximos 7 días' });
    expect(within(secProx).getByText('Luis Gómez')).toBeInTheDocument();
    expect(within(secProx).getByRole('heading', { name: /martes, 17 de noviembre/i })).toBeInTheDocument();
    expect(within(secProx).queryByText('Ana Pérez')).not.toBeInTheDocument();
  });

  test('sin citas lo dice en cada sección', () => {
    render(<MiDia citas={[]} tipos={tipos} zona={ZONA} hoy="2026-11-15" />);
    expect(screen.getByText('No tienes citas hoy')).toBeInTheDocument();
    expect(screen.getByText('No hay citas agendadas en los próximos 7 días')).toBeInTheDocument();
  });
});

describe('SelectorMedico', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  test('elegir un médico cambia la dirección de la página', async () => {
    render(<SelectorMedico medicos={medicos} valor={MEDICO} />);
    await userEvent.selectOptions(screen.getByLabelText('Médico'), OTRO);
    expect(router.push).toHaveBeenCalledWith(`/mi-dia?medico=${OTRO}`);
  });

  test('sin médico elegido ofrece la opción vacía', () => {
    render(<SelectorMedico medicos={medicos} valor="" />);
    expect(screen.getByRole('option', { name: 'Elige un médico' })).toBeInTheDocument();
  });
});
