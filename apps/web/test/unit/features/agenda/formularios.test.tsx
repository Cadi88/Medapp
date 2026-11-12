import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const acciones = vi.hoisted(() => ({
  crearCita: vi.fn(),
  reprogramarCita: vi.fn(),
  cambiarEstadoCita: vi.fn(),
  cargarHuecos: vi.fn(),
  cargarCitas: vi.fn(),
}));
vi.mock('@/features/agenda/actions', () => acciones);

const { FormularioCita } = await import('@/features/agenda/components/FormularioCita');
const { DetalleCita } = await import('@/features/agenda/components/DetalleCita');
const { FiltroMedico } = await import('@/features/agenda/components/FiltroMedico');

const M1 = '0190a0a0-0000-7000-8000-00000000000a';
const M2 = '0190a0a0-0000-7000-8000-00000000000d';
const T1 = '0190a0a0-0000-7000-8000-00000000000b';
const T2 = '0190a0a0-0000-7000-8000-00000000000e';
const ZONA = 'America/Mexico_City';
const H1 = '2026-11-12T16:00:00.000Z'; // 10:00
const H2 = '2026-11-12T16:30:00.000Z'; // 10:30
const medicos: MedicoAgenda[] = [
  { usuarioId: M1, nombre: 'Dra. Ruiz' },
  { usuarioId: M2, nombre: 'Dr. Soto' },
];
const tipos: TipoCita[] = [
  { id: T1, medicoId: M1, nombre: 'Consulta', duracionMin: 30, activo: true },
  { id: T2, medicoId: M2, nombre: 'Revisión', duracionMin: 20, activo: true },
  { id: '0190a0a0-0000-7000-8000-00000000000f', medicoId: M1, nombre: 'Vieja', duracionMin: 20, activo: false },
];

beforeEach(() => {
  for (const f of Object.values(acciones)) f.mockReset();
  acciones.cargarHuecos.mockResolvedValue({ ok: true, huecos: [H1, H2] });
});
afterEach(cleanup);

async function elegirTipo() {
  await userEvent.selectOptions(screen.getByLabelText('Tipo de cita'), T1);
}

describe('FormularioCita (alta)', () => {
  const props = { medicos: [medicos[0] as MedicoAgenda], tipos, zona: ZONA, fechaInicial: '2026-11-12', onListo: vi.fn(), onCancelar: vi.fn() };

  test('al elegir tipo y fecha muestra los huecos en la hora del consultorio; solo tipos activos del médico', async () => {
    render(<FormularioCita {...props} />);
    expect(screen.queryByRole('option', { name: /Vieja/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Revisión/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Tipo de cita'), T1);

    expect(await screen.findByRole('radio', { name: '10:00' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '10:30' })).toBeInTheDocument();
    expect(acciones.cargarHuecos).toHaveBeenCalledWith(M1, '2026-11-12', T1);
  });

  test('sin huecos avisa que no hay disponibilidad', async () => {
    acciones.cargarHuecos.mockResolvedValue({ ok: true, huecos: [] });
    render(<FormularioCita {...props} />);
    await userEvent.selectOptions(screen.getByLabelText('Tipo de cita'), T1);
    expect(await screen.findByText('No hay horarios disponibles ese día')).toBeInTheDocument();
  });

  test('con varios médicos hay que elegir uno y los tipos son los suyos', async () => {
    render(<FormularioCita {...props} medicos={medicos} />);
    expect(screen.getByLabelText('Tipo de cita')).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Médico'), M2);
    expect(screen.getByRole('option', { name: /Revisión/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Consulta/ })).not.toBeInTheDocument();
  });

  test('envía el hueco elegido con los datos de contacto y avisa al terminar', async () => {
    acciones.crearCita.mockResolvedValue({ ok: true });
    const onListo = vi.fn();
    render(<FormularioCita {...props} onListo={onListo} />);
    await elegirTipo();
    await userEvent.click(await screen.findByRole('radio', { name: '10:30' }));
    await userEvent.type(screen.getByLabelText('Nombre del paciente'), 'Ana Pérez');
    await userEvent.type(screen.getByLabelText('Teléfono'), '5551234567');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));

    await waitFor(() => expect(onListo).toHaveBeenCalled());
    expect(acciones.crearCita).toHaveBeenCalledWith({
      medicoId: M1,
      tipoCitaId: T1,
      inicio: H2,
      nombre: 'Ana Pérez',
      telefono: '5551234567',
      email: '',
      notas: '',
      fueraDeHorario: false,
    });
  });

  test('sin hueco elegido no envía y lo pide', async () => {
    render(<FormularioCita {...props} />);
    await userEvent.type(screen.getByLabelText('Nombre del paciente'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    expect(acciones.crearCita).not.toHaveBeenCalled();
    expect(await screen.findByText('Elige tipo de cita, fecha y horario')).toBeInTheDocument();
  });

  test('HORARIO_OCUPADO muestra el aviso y recarga los huecos', async () => {
    acciones.crearCita.mockResolvedValue({ mensaje: 'Ese horario ya se ocupó, elige otro', recargar: true });
    render(<FormularioCita {...props} />);
    await elegirTipo();
    await userEvent.click(await screen.findByRole('radio', { name: '10:00' }));
    await userEvent.type(screen.getByLabelText('Nombre del paciente'), 'Ana Pérez');
    await userEvent.type(screen.getByLabelText('Teléfono'), '5551234567');
    const antes = acciones.cargarHuecos.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));

    expect(await screen.findByText('Ese horario ya se ocupó, elige otro')).toBeInTheDocument();
    await waitFor(() => expect(acciones.cargarHuecos.mock.calls.length).toBeGreaterThan(antes));
    // el hueco elegido ya no es válido: hay que elegir otro
    expect(screen.getByRole('radio', { name: '10:00' })).not.toBeChecked();
  });

  test('FUERA_DE_HORARIO ofrece "Agendar de todos modos" y reenvía con fueraDeHorario', async () => {
    acciones.crearCita.mockResolvedValueOnce({ ok: false, motivo: 'FUERA_DE_HORARIO' }).mockResolvedValueOnce({ ok: true });
    const onListo = vi.fn();
    render(<FormularioCita {...props} onListo={onListo} />);
    await elegirTipo();
    await userEvent.click(await screen.findByRole('radio', { name: '10:00' }));
    await userEvent.type(screen.getByLabelText('Nombre del paciente'), 'Ana Pérez');
    await userEvent.type(screen.getByLabelText('Teléfono'), '5551234567');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Agendar de todos modos' }));
    await waitFor(() => expect(onListo).toHaveBeenCalled());
    expect(acciones.crearCita).toHaveBeenLastCalledWith(expect.objectContaining({ fueraDeHorario: true, inicio: H1 }));
  });

  test('errores de validación aparecen junto a su campo', async () => {
    acciones.crearCita.mockResolvedValue({ errores: { telefono: 'Escribe un teléfono válido' } });
    render(<FormularioCita {...props} />);
    await elegirTipo();
    await userEvent.click(await screen.findByRole('radio', { name: '10:00' }));
    await userEvent.type(screen.getByLabelText('Nombre del paciente'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }));
    expect(await screen.findByText('Escribe un teléfono válido')).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveAttribute('aria-invalid', 'true');
  });

  test('Cancelar llama a onCancelar', async () => {
    const onCancelar = vi.fn();
    render(<FormularioCita {...props} onCancelar={onCancelar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancelar).toHaveBeenCalled();
  });
});

const cita = (extra: Partial<Cita> = {}): Cita => ({
  id: '0190a0a0-0000-7000-8000-0000000000c1',
  medicoId: M1,
  tipoCitaId: T1,
  inicio: H1,
  fin: H2,
  estado: 'agendada',
  contacto: { nombre: 'Ana Pérez', telefono: '5551234567', email: 'ana@ejemplo.mx' },
  notas: 'Trae estudios',
  fueraDeHorario: false,
  version: 3,
  ...extra,
});

describe('FormularioCita (reprogramar)', () => {
  test('con cita: médico y contacto no se editan; envía reprogramarCita con la versión', async () => {
    acciones.reprogramarCita.mockResolvedValue({ ok: true });
    const onListo = vi.fn();
    render(<FormularioCita medicos={medicos} tipos={tipos} zona={ZONA} cita={cita()} onListo={onListo} onCancelar={vi.fn()} />);
    expect(screen.queryByLabelText('Nombre del paciente')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Médico')).toBeDisabled();
    expect(screen.getByLabelText('Tipo de cita')).toHaveValue(T1);
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-12');

    await userEvent.click(await screen.findByRole('radio', { name: '10:30' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reprogramar' }));
    await waitFor(() => expect(onListo).toHaveBeenCalled());
    expect(acciones.reprogramarCita).toHaveBeenCalledWith({
      citaId: '0190a0a0-0000-7000-8000-0000000000c1',
      version: 3,
      inicio: H2,
      tipoCitaId: T1,
      fueraDeHorario: false,
    });
  });

  test('CONFLICTO_VERSION muestra "Alguien modificó esta cita" y avisa para recargar', async () => {
    acciones.reprogramarCita.mockResolvedValue({ mensaje: 'Alguien modificó esta cita', recargar: true });
    const onConflicto = vi.fn();
    render(<FormularioCita medicos={medicos} tipos={tipos} zona={ZONA} cita={cita()} onListo={vi.fn()} onCancelar={vi.fn()} onConflicto={onConflicto} />);
    await userEvent.click(await screen.findByRole('radio', { name: '10:30' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reprogramar' }));
    expect(await screen.findByText('Alguien modificó esta cita')).toBeInTheDocument();
    expect(onConflicto).toHaveBeenCalled();
  });
});

describe('DetalleCita', () => {
  const props = { medico: 'Dra. Ruiz', tipo: 'Consulta', zona: ZONA, onCambio: vi.fn(), onReprogramar: vi.fn() };
  const botones = () => screen.getAllByRole('button').map((b) => b.textContent);

  test('muestra datos de la cita y, si es agendada, solo las transiciones permitidas', () => {
    render(<DetalleCita {...props} cita={cita()} />);
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('Dra. Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Trae estudios')).toBeInTheDocument();
    expect(botones()).toEqual(['Confirmar', 'Marcar atendida', 'No asistió', 'Cancelar cita', 'Reprogramar']);
  });

  test('confirmada no ofrece Confirmar', () => {
    render(<DetalleCita {...props} cita={cita({ estado: 'confirmada' })} />);
    expect(botones()).toEqual(['Marcar atendida', 'No asistió', 'Cancelar cita', 'Reprogramar']);
  });

  test.each(['atendida', 'no_asistio', 'cancelada'] as const)('%s es final: sin acciones', (estado) => {
    render(<DetalleCita {...props} cita={cita({ estado })} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  test('cambiar estado llama a la acción con la versión y avisa', async () => {
    acciones.cambiarEstadoCita.mockResolvedValue({ ok: true });
    const onCambio = vi.fn();
    render(<DetalleCita {...props} onCambio={onCambio} cita={cita()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
    expect(acciones.cambiarEstadoCita).toHaveBeenCalledWith({ citaId: '0190a0a0-0000-7000-8000-0000000000c1', version: 3, estado: 'confirmada' });
  });

  test('si falla muestra el mensaje y avisa que hay que recargar', async () => {
    acciones.cambiarEstadoCita.mockResolvedValue({ mensaje: 'Alguien modificó esta cita', recargar: true });
    const onCambio = vi.fn();
    render(<DetalleCita {...props} onCambio={onCambio} cita={cita()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar cita' }));
    expect(await screen.findByText('Alguien modificó esta cita')).toBeInTheDocument();
    expect(onCambio).toHaveBeenCalled();
  });

  test('Reprogramar llama a onReprogramar', async () => {
    const onReprogramar = vi.fn();
    render(<DetalleCita {...props} onReprogramar={onReprogramar} cita={cita()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reprogramar' }));
    expect(onReprogramar).toHaveBeenCalled();
  });
});

describe('FiltroMedico', () => {
  test('lista todos los médicos y reporta el cambio ("" = todos)', async () => {
    const onCambio = vi.fn();
    render(<FiltroMedico medicos={medicos} valor="" onCambio={onCambio} />);
    expect(screen.getByRole('option', { name: 'Todos los médicos' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Médico'), M2);
    expect(onCambio).toHaveBeenCalledWith(M2);
  });
});
