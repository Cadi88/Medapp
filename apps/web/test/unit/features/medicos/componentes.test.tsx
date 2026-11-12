import '@testing-library/jest-dom/vitest';
import type { Bloqueo, TipoCita } from '@consultorio/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const acciones = vi.hoisted(() => ({
  guardarSemana: vi.fn(),
  crearTipoCita: vi.fn(),
  editarTipoCita: vi.fn(),
  crearBloqueo: vi.fn(),
  eliminarBloqueo: vi.fn(),
}));
vi.mock('@/features/medicos/actions', () => acciones);

const { FormularioHorario } = await import('@/features/medicos/components/FormularioHorario');
const { SeccionTiposCita } = await import('@/features/medicos/components/SeccionTiposCita');
const { SeccionBloqueos } = await import('@/features/medicos/components/SeccionBloqueos');
const { FichaMedico } = await import('@/features/medicos/components/FichaMedico');
const { ListaMedicos } = await import('@/features/medicos/components/ListaMedicos');

const MEDICO = '0190a0a0-0000-7000-8000-00000000000a';
const ZONA = 'America/Mexico_City';

beforeEach(() => {
  for (const f of Object.values(acciones)) f.mockReset();
});
afterEach(cleanup);

describe('FormularioHorario', () => {
  const bloques = [
    { diaSemana: 1, horaInicio: '09:00', horaFin: '13:00' },
    { diaSemana: 1, horaInicio: '15:00', horaFin: '18:00' },
  ];

  test('muestra los bloques de cada día y "Sin atención" donde no hay', () => {
    render(<FormularioHorario medicoId={MEDICO} bloques={bloques} />);
    const lunes = screen.getByRole('group', { name: 'Lunes' });
    expect(within(lunes).getAllByLabelText(/^Inicio/)).toHaveLength(2);
    expect(within(lunes).getAllByLabelText(/^Inicio/)[0]).toHaveValue('09:00');
    expect(within(screen.getByRole('group', { name: 'Martes' })).getByText('Sin atención')).toBeInTheDocument();
  });

  test('agrega un bloque en un día y envía todas las filas', async () => {
    acciones.guardarSemana.mockResolvedValueOnce({ ok: true });
    render(<FormularioHorario medicoId={MEDICO} bloques={[]} />);
    const martes = screen.getByRole('group', { name: 'Martes' });
    await userEvent.click(within(martes).getByRole('button', { name: 'Agregar bloque' }));
    await userEvent.type(within(martes).getByLabelText(/^Inicio/), '09:00');
    await userEvent.type(within(martes).getByLabelText(/^Fin/), '13:00');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }));

    expect(await screen.findByText('Horario guardado')).toBeInTheDocument();
    const fd = acciones.guardarSemana.mock.calls[0]?.[1] as FormData;
    expect(fd.get('medicoId')).toBe(MEDICO);
    expect(fd.getAll('diaSemana')).toEqual(['2']);
    expect(fd.getAll('horaInicio')).toEqual(['09:00']);
    expect(fd.getAll('horaFin')).toEqual(['13:00']);
  });

  test('quitar un bloque lo elimina de la lista', async () => {
    render(<FormularioHorario medicoId={MEDICO} bloques={bloques} />);
    const lunes = screen.getByRole('group', { name: 'Lunes' });
    await userEvent.click(within(lunes).getAllByRole('button', { name: 'Quitar bloque' })[0] as HTMLElement);
    expect(within(lunes).getAllByLabelText(/^Inicio/)).toHaveLength(1);
    expect(within(lunes).getByLabelText(/^Inicio/)).toHaveValue('15:00');
  });

  test('bloques encimados se señalan antes de enviar', async () => {
    render(<FormularioHorario medicoId={MEDICO} bloques={[{ diaSemana: 1, horaInicio: '09:00', horaFin: '13:00' }, { diaSemana: 1, horaInicio: '12:00', horaFin: '14:00' }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Los bloques del lunes se enciman: 09:00–13:00 y 12:00–14:00');
    expect(acciones.guardarSemana).not.toHaveBeenCalled();
  });

  test('muestra el error que devuelve el servicio', async () => {
    acciones.guardarSemana.mockResolvedValueOnce({ mensaje: 'Los bloques del horario se enciman' });
    render(<FormularioHorario medicoId={MEDICO} bloques={bloques} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Los bloques del horario se enciman');
  });
});

const tipo = (n: number, extra: Partial<TipoCita> = {}): TipoCita => ({
  id: `0190a0a0-0000-7000-8000-00000000010${n}`,
  medicoId: MEDICO,
  nombre: `Tipo ${n}`,
  duracionMin: 30,
  activo: true,
  ...extra,
});

describe('SeccionTiposCita', () => {
  test('lista los tipos con su estado y permite crear uno', async () => {
    acciones.crearTipoCita.mockResolvedValueOnce({ ok: true });
    render(<SeccionTiposCita medicoId={MEDICO} tipos={[tipo(1), tipo(2, { activo: false })]} />);
    expect(screen.getByLabelText('Nombre de Tipo 1')).toHaveValue('Tipo 1');
    expect(within(screen.getByRole('form', { name: 'Editar Tipo 2' })).getByLabelText('Activo')).not.toBeChecked();

    await userEvent.type(screen.getByLabelText('Nombre del tipo'), 'Primera vez');
    await userEvent.type(screen.getByLabelText('Duración (min)'), '45');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar tipo' }));
    const fd = acciones.crearTipoCita.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(fd.entries())).toEqual({ medicoId: MEDICO, nombre: 'Primera vez', duracionMin: '45' });
  });

  test('muestra errores de campo al crear', async () => {
    acciones.crearTipoCita.mockResolvedValueOnce({ errores: { duracionMin: 'La duración debe ser de 5 a 480 minutos' }, valores: { nombre: 'X', duracionMin: '2' } });
    render(<SeccionTiposCita medicoId={MEDICO} tipos={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar tipo' }));
    expect(await screen.findByText('La duración debe ser de 5 a 480 minutos')).toBeInTheDocument();
    expect(screen.getByText('Este médico aún no tiene tipos de cita')).toBeInTheDocument();
  });

  test('editar y desactivar envía el formulario de esa fila; muestra el error', async () => {
    acciones.editarTipoCita.mockResolvedValueOnce({ mensaje: 'El registro ya no existe' });
    render(<SeccionTiposCita medicoId={MEDICO} tipos={[tipo(1)]} />);
    const fila = screen.getByRole('form', { name: 'Editar Tipo 1' });
    await userEvent.click(within(fila).getByLabelText('Activo'));
    await userEvent.click(within(fila).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El registro ya no existe');
    const fd = acciones.editarTipoCita.mock.calls[0]?.[1] as FormData;
    expect(fd.get('tipoId')).toBe(tipo(1).id);
    expect(fd.get('activo')).toBeNull();
    expect(fd.get('duracionMin')).toBe('30');
  });
});

const bloqueo = (n: number, motivo: string | null): Bloqueo => ({
  id: `0190a0a0-0000-7000-8000-00000000020${n}`,
  medicoId: MEDICO,
  inicio: '2026-11-12T16:00:00.000Z',
  fin: '2026-11-12T18:00:00.000Z',
  motivo,
});

describe('SeccionBloqueos', () => {
  test('lista los bloqueos en la hora del consultorio y crea uno nuevo', async () => {
    acciones.crearBloqueo.mockResolvedValueOnce({ ok: true });
    render(<SeccionBloqueos medicoId={MEDICO} bloqueos={[bloqueo(1, 'Congreso'), bloqueo(2, null)]} zona={ZONA} />);
    const lista = screen.getByRole('list', { name: 'Bloqueos próximos' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2);
    expect(lista).toHaveTextContent('12 nov 2026, 10:00');
    expect(lista).toHaveTextContent('12 nov 2026, 12:00');
    expect(lista).toHaveTextContent('Congreso');

    await userEvent.type(screen.getByLabelText('Inicio del bloqueo'), '2026-11-20T09:00');
    await userEvent.type(screen.getByLabelText('Fin del bloqueo'), '2026-11-20T11:00');
    await userEvent.type(screen.getByLabelText('Motivo (opcional)'), 'Vacaciones');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar bloqueo' }));
    const fd = acciones.crearBloqueo.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(fd.entries())).toEqual({ medicoId: MEDICO, inicio: '2026-11-20T09:00', fin: '2026-11-20T11:00', motivo: 'Vacaciones' });
  });

  test('sin bloqueos lo avisa y muestra el error de fechas', async () => {
    acciones.crearBloqueo.mockResolvedValueOnce({ errores: { fin: 'El inicio debe ser anterior al fin' } });
    render(<SeccionBloqueos medicoId={MEDICO} bloqueos={[]} zona={ZONA} />);
    expect(screen.getByText('No hay bloqueos próximos')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar bloqueo' }));
    expect(await screen.findByText('El inicio debe ser anterior al fin')).toBeInTheDocument();
  });

  test('eliminar envía el bloqueo y muestra el error si falla', async () => {
    acciones.eliminarBloqueo.mockResolvedValueOnce({ mensaje: 'Ocurrió un error. Intenta de nuevo.' });
    render(<SeccionBloqueos medicoId={MEDICO} bloqueos={[bloqueo(1, 'Congreso')]} zona={ZONA} />);
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar bloqueo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error');
    const fd = acciones.eliminarBloqueo.mock.calls[0]?.[1] as FormData;
    expect(fd.get('bloqueoId')).toBe(bloqueo(1, null).id);
    expect(fd.get('medicoId')).toBe(MEDICO);
  });
});

describe('FichaMedico y ListaMedicos', () => {
  test('la ficha ofrece las pestañas Horario, Tipos de cita y Bloqueos', async () => {
    render(<FichaMedico medicoId={MEDICO} bloques={[]} tipos={[tipo(1)]} bloqueos={[]} zona={ZONA} />);
    expect(screen.getByRole('tab', { name: 'Horario' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Guardar horario' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Tipos de cita' }));
    expect(await screen.findByLabelText('Nombre de Tipo 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Bloqueos' }));
    expect(await screen.findByText('No hay bloqueos próximos')).toBeInTheDocument();
  });

  test('la lista enlaza a la ficha de cada médico', () => {
    render(<ListaMedicos medicos={[{ usuarioId: MEDICO, nombre: 'Dra. Ruiz' }]} />);
    expect(screen.getByRole('link', { name: 'Dra. Ruiz' })).toHaveAttribute('href', `/medicos/${MEDICO}`);
  });

  test('sin médicos lo avisa', () => {
    render(<ListaMedicos medicos={[]} />);
    expect(screen.getByText('Aún no hay médicos en el consultorio')).toBeInTheDocument();
  });
});
