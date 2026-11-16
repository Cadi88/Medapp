import '@testing-library/jest-dom/vitest';
import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/features/agenda/actions', () => ({ cambiarEstadoCita: vi.fn() }));

const { ListaDelDia } = await import('@/features/agenda/components/ListaDelDia');
const { DetalleCita } = await import('@/features/agenda/components/DetalleCita');

const MEDICO = '0190a0a0-0000-7000-8000-00000000000a';
const TIPO = '0190a0a0-0000-7000-8000-00000000000b';
const medicos: MedicoAgenda[] = [{ usuarioId: MEDICO, nombre: 'Dra. Ruiz' }];
const tipos: TipoCita[] = [{ id: TIPO, medicoId: MEDICO, nombre: 'Consulta', duracionMin: 30, activo: true }];
const cita = (pideCambio: boolean): Cita => ({
  id: '0190a0a0-0000-7000-8000-0000000000c1',
  medicoId: MEDICO,
  tipoCitaId: TIPO,
  inicio: '2026-11-12T16:00:00.000Z',
  fin: '2026-11-12T16:30:00.000Z',
  estado: 'agendada',
  contacto: { nombre: 'Ana Pérez', telefono: '5551234567' },
  fueraDeHorario: false,
  pideCambio,
  version: 1,
});

afterEach(cleanup);

describe('"Pide cambio" en la agenda', () => {
  const lista = (pide: boolean) =>
    render(
      <ListaDelDia citas={[cita(pide)]} medicos={medicos} tipos={tipos} zona="America/Mexico_City" fecha="2026-11-12" onFecha={vi.fn()} onSeleccionar={vi.fn()} onNueva={vi.fn()} />,
    );

  test('la lista del día marca la cita que pide cambio', () => {
    lista(true);
    expect(screen.getByText('Pide cambio')).toBeInTheDocument();
  });

  test('sin pedirlo no aparece', () => {
    lista(false);
    expect(screen.queryByText('Pide cambio')).not.toBeInTheDocument();
  });

  test('el detalle de la cita también', () => {
    const { unmount } = render(<DetalleCita cita={cita(true)} medico="Dra. Ruiz" tipo="Consulta" zona="America/Mexico_City" onCambio={vi.fn()} onReprogramar={vi.fn()} />);
    expect(screen.getByText('Pide cambio')).toBeInTheDocument();
    unmount();
    render(<DetalleCita cita={cita(false)} medico="Dra. Ruiz" tipo="Consulta" zona="America/Mexico_City" onCambio={vi.fn()} onReprogramar={vi.fn()} />);
    expect(screen.queryByText('Pide cambio')).not.toBeInTheDocument();
  });
});
