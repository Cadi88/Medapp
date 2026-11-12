import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventInput } from '@fullcalendar/core';
import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/** FullCalendar no se puede maquetar en jsdom: se sustituye por un doble que guarda las props recibidas. */
const fc = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('@fullcalendar/react', () => ({
  default: (props: Record<string, unknown>) => {
    fc.props = props;
    return <div data-testid="fullcalendar" />;
  },
}));

const { Calendario } = await import('@/features/agenda/components/Calendario');
const { ListaDelDia } = await import('@/features/agenda/components/ListaDelDia');

const ZONA = 'America/Mexico_City';
const eventos: EventInput[] = [{ id: 'c1', title: 'Ana', start: '2026-11-12T16:00:00.000Z', editable: true }];

const base = {
  eventos,
  zona: ZONA,
  onRango: vi.fn(),
  onSeleccionar: vi.fn(),
  onHueco: vi.fn(),
  onReprogramar: vi.fn(),
};
const prop = <T,>(nombre: string) => fc.props[nombre] as T;

beforeEach(() => {
  fc.props = {};
  for (const f of [base.onRango, base.onSeleccionar, base.onHueco, base.onReprogramar]) f.mockReset();
});
afterEach(cleanup);

describe('Calendario', () => {
  test('configura FullCalendar: vistas de día y semana, español y zona del consultorio', () => {
    render(<Calendario {...base} />);
    expect(prop('timeZone')).toBe(ZONA);
    expect(prop('locale')).toBe('es');
    expect(prop('initialView')).toBe('timeGridDay');
    expect(prop<{ right: string }>('headerToolbar').right).toBe('timeGridDay,timeGridWeek');
    expect(prop('events')).toBe(eventos);
    expect(prop('editable')).toBe(true);
    expect(prop('eventDurationEditable')).toBe(false);
    expect(prop<unknown[]>('plugins')).toHaveLength(4 + 1); // daygrid, timegrid, interaction, list + luxon3
  });

  test('datesSet informa el rango visible como instantes UTC', () => {
    render(<Calendario {...base} />);
    prop<(a: { startStr: string; endStr: string }) => void>('datesSet')({
      startStr: '2026-11-12T00:00:00-06:00',
      endStr: '2026-11-13T00:00:00-06:00',
    });
    expect(base.onRango).toHaveBeenCalledWith('2026-11-12T06:00:00.000Z', '2026-11-13T06:00:00.000Z');
  });

  test('clic en una cita y en un hueco vacío', () => {
    render(<Calendario {...base} />);
    prop<(a: { event: { id: string } }) => void>('eventClick')({ event: { id: 'c1' } });
    expect(base.onSeleccionar).toHaveBeenCalledWith('c1');
    prop<(a: { dateStr: string }) => void>('dateClick')({ dateStr: '2026-11-12T10:00:00-06:00' });
    expect(base.onHueco).toHaveBeenCalledWith('2026-11-12T16:00:00.000Z');
  });

  test('eventDrop reprograma con el nuevo inicio en UTC y NO revierte si sale bien', async () => {
    base.onReprogramar.mockResolvedValue(true);
    render(<Calendario {...base} />);
    const revert = vi.fn();
    await prop<(a: unknown) => Promise<void>>('eventDrop')({ event: { id: 'c1', startStr: '2026-11-12T11:00:00-06:00' }, revert });
    expect(base.onReprogramar).toHaveBeenCalledWith('c1', '2026-11-12T17:00:00.000Z');
    expect(revert).not.toHaveBeenCalled();
  });

  test('eventDrop revierte con info.revert() si la reprogramación falla', async () => {
    base.onReprogramar.mockResolvedValue(false);
    render(<Calendario {...base} />);
    const revert = vi.fn();
    await prop<(a: unknown) => Promise<void>>('eventDrop')({ event: { id: 'c1', startStr: '2026-11-12T11:00:00-06:00' }, revert });
    expect(revert).toHaveBeenCalledTimes(1);
  });

  test('eventDrop revierte también si la acción lanza', async () => {
    base.onReprogramar.mockRejectedValue(new Error('red'));
    render(<Calendario {...base} />);
    const revert = vi.fn();
    await prop<(a: unknown) => Promise<void>>('eventDrop')({ event: { id: 'c1', startStr: '2026-11-12T11:00:00-06:00' }, revert });
    expect(revert).toHaveBeenCalledTimes(1);
  });
});

const M1 = '0190a0a0-0000-7000-8000-00000000000a';
const T1 = '0190a0a0-0000-7000-8000-00000000000b';
const medicos: MedicoAgenda[] = [{ usuarioId: M1, nombre: 'Dra. Ruiz' }];
const tipos: TipoCita[] = [{ id: T1, medicoId: M1, nombre: 'Consulta', duracionMin: 30, activo: true }];
const cita = (id: string, inicio: string, extra: Partial<Cita> = {}): Cita => ({
  id,
  medicoId: M1,
  tipoCitaId: T1,
  inicio,
  fin: new Date(Date.parse(inicio) + 30 * 60_000).toISOString(),
  estado: 'agendada',
  contacto: { nombre: `Paciente ${id}`, telefono: '5551234567' },
  fueraDeHorario: false,
  version: 1,
  ...extra,
});

describe('ListaDelDia', () => {
  const props = { medicos, tipos, zona: ZONA, fecha: '2026-11-12', onFecha: vi.fn(), onSeleccionar: vi.fn(), onNueva: vi.fn() };

  test('ordena por hora y muestra estado y hora local', () => {
    const citas = [
      cita('b', '2026-11-12T18:00:00.000Z', { estado: 'confirmada' }),
      cita('a', '2026-11-12T16:00:00.000Z'),
      cita('c', '2026-11-12T17:00:00.000Z', { estado: 'cancelada' }),
    ];
    render(<ListaDelDia {...props} citas={citas} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Paciente a'),
      expect.stringContaining('Paciente c'),
      expect.stringContaining('Paciente b'),
    ]);
    expect(items[0]).toHaveTextContent('10:00');
    expect(items[0]).toHaveTextContent('Agendada');
    expect(items[1]).toHaveTextContent('Cancelada');
    expect(items[2]).toHaveTextContent('Confirmada');
    expect(items[0]).toHaveTextContent('Consulta');
  });

  test('sin citas lo dice', () => {
    render(<ListaDelDia {...props} citas={[]} />);
    expect(screen.getByText('No hay citas este día')).toBeInTheDocument();
  });

  test('tocar una cita la abre; navegación de día y nueva cita', async () => {
    const onSeleccionar = vi.fn();
    const onFecha = vi.fn();
    const onNueva = vi.fn();
    const citas = [cita('a', '2026-11-12T16:00:00.000Z')];
    render(<ListaDelDia {...props} citas={citas} onSeleccionar={onSeleccionar} onFecha={onFecha} onNueva={onNueva} />);
    await userEvent.click(screen.getByRole('button', { name: /Paciente a/ }));
    expect(onSeleccionar).toHaveBeenCalledWith(citas[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Día siguiente' }));
    expect(onFecha).toHaveBeenLastCalledWith('2026-11-13');
    await userEvent.click(screen.getByRole('button', { name: 'Día anterior' }));
    expect(onFecha).toHaveBeenLastCalledWith('2026-11-11');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva cita' }));
    expect(onNueva).toHaveBeenCalled();
  });
});
