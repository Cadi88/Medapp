import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fechaLocal, rangoDelDia } from '@/features/agenda/logica/formato';

const fc = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('@fullcalendar/react', () => ({
  default: (props: Record<string, unknown>) => {
    fc.props = props;
    return <div data-testid="fullcalendar" />;
  },
}));
const acciones = vi.hoisted(() => ({
  crearCita: vi.fn(),
  reprogramarCita: vi.fn(),
  cambiarEstadoCita: vi.fn(),
  cargarHuecos: vi.fn(),
  cargarCitas: vi.fn(),
}));
vi.mock('@/features/agenda/actions', () => acciones);
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { AgendaCliente } = await import('@/features/agenda/components/AgendaCliente');

const ZONA = 'America/Mexico_City';
const M1 = '0190a0a0-0000-7000-8000-00000000000a';
const M2 = '0190a0a0-0000-7000-8000-00000000000d';
const T1 = '0190a0a0-0000-7000-8000-00000000000b';
const medicos: MedicoAgenda[] = [
  { usuarioId: M1, nombre: 'Dra. Ruiz' },
  { usuarioId: M2, nombre: 'Dr. Soto' },
];
const tipos: TipoCita[] = [{ id: T1, medicoId: M1, nombre: 'Consulta', duracionMin: 30, activo: true }];
const cita: Cita = {
  id: '0190a0a0-0000-7000-8000-0000000000c1',
  medicoId: M1,
  tipoCitaId: T1,
  inicio: '2026-11-12T16:00:00.000Z',
  fin: '2026-11-12T16:30:00.000Z',
  estado: 'agendada',
  contacto: { nombre: 'Ana Pérez', telefono: '5551234567' },
  fueraDeHorario: false,
  version: 4,
};
const RANGO = ['2026-11-12T06:00:00.000Z', '2026-11-13T06:00:00.000Z'] as const;

function fijarMovil(esMovil: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: esMovil,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
const eventosActuales = () => fc.props.events as { id: string; title: string }[];
const verRango = async () => {
  await act(async () => {
    (fc.props.datesSet as (a: { startStr: string; endStr: string }) => void)({ startStr: RANGO[0], endStr: RANGO[1] });
  });
};

beforeEach(() => {
  fc.props = {};
  for (const f of Object.values(acciones)) f.mockReset();
  toast.error.mockReset();
  acciones.cargarCitas.mockResolvedValue({ ok: true, citas: [cita] });
  fijarMovil(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgendaCliente (escritorio)', () => {
  test('carga las citas del rango visible y las pasa al calendario como eventos', async () => {
    render(<AgendaCliente medicos={medicos} tipos={tipos} zona={ZONA} puedeFiltrar />);
    await verRango();
    await waitFor(() => expect(eventosActuales()).toHaveLength(1));
    expect(acciones.cargarCitas).toHaveBeenCalledWith(RANGO[0], RANGO[1], undefined);
    expect(eventosActuales()[0]?.title).toBe('Ana Pérez · Consulta');
  });

  test('el filtro por médico vuelve a cargar con medicoId; un médico sin permiso no lo ve', async () => {
    const { unmount } = render(<AgendaCliente medicos={medicos} tipos={tipos} zona={ZONA} puedeFiltrar />);
    await verRango();
    await userEvent.selectOptions(screen.getByLabelText('Médico'), M2);
    await waitFor(() => expect(acciones.cargarCitas).toHaveBeenLastCalledWith(RANGO[0], RANGO[1], M2));
    unmount();
    render(<AgendaCliente medicos={[medicos[0] as MedicoAgenda]} tipos={tipos} zona={ZONA} puedeFiltrar={false} />);
    expect(screen.queryByLabelText('Médico')).not.toBeInTheDocument();
  });

  test('si falla la carga avisa con un mensaje genérico', async () => {
    acciones.cargarCitas.mockResolvedValue({ ok: false, mensaje: 'Ocurrió un error. Intenta de nuevo.' });
    render(<AgendaCliente medicos={medicos} tipos={tipos} zona={ZONA} puedeFiltrar />);
    await verRango();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ocurrió un error. Intenta de nuevo.'));
  });

  test('arrastrar una cita la reprograma con su versión y recarga', async () => {
    acciones.reprogramarCita.mockResolvedValue({ ok: true });
    render(<AgendaCliente medicos={medicos} tipos={tipos} zona={ZONA} puedeFiltrar />);
    await verRango();
    await waitFor(() => expect(eventosActuales()).toHaveLength(1));
    const llamadas = acciones.cargarCitas.mock.calls.length;
    const ok = await (fc.props.eventDrop as (a: unknown) => Promise<void>)({
      event: { id: cita.id, startStr: '2026-11-12T11:00:00-06:00' },
      revert: vi.fn(),
    });
    expect(ok).toBeUndefined();
    expect(acciones.reprogramarCita).toHaveBeenCalledWith({ citaId: cita.id, version: 4, inicio: '2026-11-12T17:00:00.000Z' });
    await waitFor(() => expect(acciones.cargarCitas.mock.calls.length).toBeGreaterThan(llamadas));
  });

  test('si la reprogramación falla se revierte, se avisa y se recarga (versión obsoleta)', async () => {
    acciones.reprogramarCita.mockResolvedValue({ mensaje: 'Alguien modificó esta cita', recargar: true });
    render(<AgendaCliente medicos={medicos} tipos={tipos} zona={ZONA} puedeFiltrar />);
    await verRango();
    await waitFor(() => expect(eventosActuales()).toHaveLength(1));
    const revert = vi.fn();
    await (fc.props.eventDrop as (a: unknown) => Promise<void>)({ event: { id: cita.id, startStr: '2026-11-12T11:00:00-06:00' }, revert });
    expect(revert).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Alguien modificó esta cita');
  });

  test('fuera de horario pide confirmar y reenvía; si se rechaza, revierte', async () => {
    acciones.reprogramarCita.mockResolvedValueOnce({ ok: false, motivo: 'FUERA_DE_HORARIO' }).mockResolvedValueOnce({ ok: true });
    const confirmar = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.stubGlobal('confirm', confirmar);
    render(<AgendaCliente medicos={medicos} tipos={tipos} zona={ZONA} puedeFiltrar />);
    await verRango();
    await waitFor(() => expect(eventosActuales()).toHaveLength(1));
    const evento = { id: cita.id, startStr: '2026-11-12T11:00:00-06:00' };

    const revert = vi.fn();
    await (fc.props.eventDrop as (a: unknown) => Promise<void>)({ event: evento, revert });
    expect(acciones.reprogramarCita).toHaveBeenLastCalledWith(expect.objectContaining({ fueraDeHorario: true }));
    expect(revert).not.toHaveBeenCalled();

    acciones.reprogramarCita.mockResolvedValueOnce({ ok: false, motivo: 'FUERA_DE_HORARIO' });
    await (fc.props.eventDrop as (a: unknown) => Promise<void>)({ event: evento, revert });
    expect(revert).toHaveBeenCalledTimes(1);
  });

  test('tocar una cita abre su detalle; un hueco vacío abre el alta', async () => {
    render(<AgendaCliente medicos={medicos} tipos={tipos} zona={ZONA} puedeFiltrar />);
    await verRango();
    await waitFor(() => expect(eventosActuales()).toHaveLength(1));
    act(() => (fc.props.eventClick as (a: unknown) => void)({ event: { id: cita.id } }));
    expect(await screen.findByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument());

    act(() => (fc.props.dateClick as (a: unknown) => void)({ dateStr: '2026-11-12T10:00:00-06:00' }));
    expect(await screen.findByLabelText('Fecha')).toHaveValue('2026-11-12');
  });
});

describe('AgendaCliente (conflicto de versión)', () => {
  test('tras CONFLICTO_VERSION el reintento del formulario usa la versión nueva', async () => {
    const H1 = '2026-11-12T17:00:00.000Z';
    acciones.cargarHuecos.mockResolvedValue({ ok: true, huecos: [H1] });
    acciones.reprogramarCita
      .mockResolvedValueOnce({ mensaje: 'Alguien modificó esta cita', recargar: true })
      .mockResolvedValueOnce({ ok: true });
    render(<AgendaCliente medicos={medicos} tipos={tipos} zona={ZONA} puedeFiltrar />);
    await verRango();
    await waitFor(() => expect(eventosActuales()).toHaveLength(1));
    act(() => (fc.props.eventClick as (a: unknown) => void)({ event: { id: cita.id } }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reprogramar' }));
    await userEvent.click(await screen.findByRole('radio', { name: '11:00' }));

    // otra persona modificó la cita: al recargar llega la versión 5
    acciones.cargarCitas.mockResolvedValue({ ok: true, citas: [{ ...cita, version: 5 }] });
    await userEvent.click(screen.getAllByRole('button', { name: 'Reprogramar' }).at(-1) as HTMLElement);
    expect(await screen.findByText('Alguien modificó esta cita')).toBeInTheDocument();
    expect(acciones.reprogramarCita).toHaveBeenLastCalledWith(expect.objectContaining({ version: 4 }));

    await userEvent.click(await screen.findByRole('radio', { name: '11:00' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Reprogramar' }).at(-1) as HTMLElement);
    await waitFor(() => expect(acciones.reprogramarCita).toHaveBeenCalledTimes(2));
    expect(acciones.reprogramarCita).toHaveBeenLastCalledWith(expect.objectContaining({ version: 5 }));
  });
});

describe('AgendaCliente (móvil)', () => {
  test('por debajo de 768 px muestra la lista del día y carga el día de hoy', async () => {
    fijarMovil(true);
    render(<AgendaCliente medicos={medicos} tipos={tipos} zona={ZONA} puedeFiltrar />);
    expect(screen.queryByTestId('fullcalendar')).not.toBeInTheDocument();
    const hoy = rangoDelDia(fechaLocal(new Date().toISOString(), ZONA), ZONA);
    await waitFor(() => expect(acciones.cargarCitas).toHaveBeenCalledWith(hoy.desde, hoy.hasta, undefined));
    expect(await screen.findByRole('button', { name: /Ana Pérez/ })).toBeInTheDocument();
  });
});
