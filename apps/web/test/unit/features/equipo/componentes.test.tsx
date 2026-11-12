import '@testing-library/jest-dom/vitest';
import type { Miembro } from '@consultorio/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const acciones = vi.hoisted(() => ({ altaMiembro: vi.fn(), editarMiembro: vi.fn(), reiniciarPassword: vi.fn(), quitarMiembro: vi.fn() }));
vi.mock('@/features/equipo/actions', () => acciones);

const { FormularioAltaMiembro } = await import('@/features/equipo/components/FormularioAltaMiembro');
const { TablaMiembros } = await import('@/features/equipo/components/TablaMiembros');

const miembro = (n: number, extra: Partial<Miembro> = {}): Miembro => ({
  usuarioId: `0190a0a0-0000-7000-8000-00000000000${n}`,
  nombre: `Persona ${n}`,
  email: `p${n}@ejemplo.mx`,
  rol: 'recepcion',
  admin: false,
  mfaActivo: false,
  debeCambiarPassword: false,
  perfilMedico: null,
  ...extra,
});

beforeEach(() => {
  for (const f of Object.values(acciones)) f.mockReset();
});
afterEach(cleanup);

describe('FormularioAltaMiembro', () => {
  test('altaMiembro muestra la contraseña temporal una sola vez', async () => {
    acciones.altaMiembro.mockResolvedValueOnce({ ok: true, passwordTemporal: 'Temporal-2026!' });
    render(<FormularioAltaMiembro />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Nombre'), 'Luis Mora');
    await userEvent.type(screen.getByLabelText('Correo'), 'luis@ejemplo.mx');
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), 'Temporal-2026!');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar al equipo' }));

    const aviso = await screen.findByRole('status');
    expect(aviso).toHaveTextContent('Temporal-2026!');
    expect(aviso).toHaveTextContent('No volverá a mostrarse');
    const fd = acciones.altaMiembro.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(fd.entries())).toMatchObject({ nombre: 'Luis Mora', email: 'luis@ejemplo.mx', rol: 'recepcion' });

    // Un componente nuevo (otra visita a la pantalla) no la vuelve a mostrar.
    cleanup();
    render(<FormularioAltaMiembro />);
    expect(screen.queryByText(/Temporal-2026!/)).not.toBeInTheDocument();
  });

  test('"Entendido" descarta el aviso de la contraseña temporal', async () => {
    acciones.altaMiembro.mockResolvedValueOnce({ ok: true, passwordTemporal: 'Temporal-2026!' });
    render(<FormularioAltaMiembro />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar al equipo' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Temporal-2026!');
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByText(/Temporal-2026!/)).not.toBeInTheDocument();
  });

  test('empezar a escribir otra alta descarta el aviso anterior', async () => {
    acciones.altaMiembro.mockResolvedValueOnce({ ok: true, passwordTemporal: 'Temporal-2026!' });
    render(<FormularioAltaMiembro />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar al equipo' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    expect(screen.queryByText(/Temporal-2026!/)).not.toBeInTheDocument();
  });

  test('muestra los errores de campo y conserva lo escrito', async () => {
    acciones.altaMiembro.mockResolvedValueOnce({
      errores: { email: 'Escribe un correo válido' },
      valores: { nombre: 'Luis', email: 'x', rol: 'medico', admin: 'on' },
    });
    render(<FormularioAltaMiembro />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar al equipo' }));
    expect(await screen.findByText('Escribe un correo válido')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Luis');
    expect(screen.getByLabelText('Rol')).toHaveValue('medico');
    expect(screen.getByLabelText('Administrador del consultorio')).toBeChecked();
  });

  test('si la persona ya tenía cuenta avisa que entra con su contraseña actual y no muestra ninguna contraseña', async () => {
    acciones.altaMiembro.mockResolvedValueOnce({ ok: true, cuentaExistente: true });
    render(<FormularioAltaMiembro />);
    await userEvent.type(screen.getByLabelText('Contraseña temporal'), 'Temporal-2026!');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar al equipo' }));
    const aviso = await screen.findByRole('status');
    expect(aviso).toHaveTextContent('Esta persona ya tenía cuenta; entra con su contraseña actual');
    expect(aviso).not.toHaveTextContent('Contraseña temporal');
    expect(screen.queryByText(/Temporal-2026!/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('error general de la API', async () => {
    acciones.altaMiembro.mockResolvedValueOnce({ mensaje: 'Ese correo ya pertenece a otra persona del consultorio' });
    render(<FormularioAltaMiembro />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar al equipo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese correo ya pertenece');
  });
});

describe('TablaMiembros', () => {
  const miembros = [miembro(1, { rol: 'medico', admin: true }), miembro(2, { debeCambiarPassword: true })];

  test('lista a las personas con su rol y permiso, y marca la contraseña temporal pendiente', () => {
    render(<TablaMiembros miembros={miembros} />);
    expect(screen.getByLabelText('Rol de Persona 1')).toHaveValue('medico');
    expect(within(screen.getByRole('form', { name: 'Editar a Persona 1' })).getByRole('checkbox')).toBeChecked();
    expect(screen.getByLabelText('Rol de Persona 2')).toHaveValue('recepcion');
    expect(screen.getAllByText('Contraseña temporal pendiente de cambio')).toHaveLength(1);
  });

  test('guardar rol y admin envía el formulario de esa fila; el 409 se muestra', async () => {
    acciones.editarMiembro.mockResolvedValueOnce({ mensaje: 'El consultorio necesita al menos un administrador' });
    render(<TablaMiembros miembros={miembros} />);
    const fila = screen.getByRole('form', { name: 'Editar a Persona 1' });
    await userEvent.selectOptions(within(fila).getByLabelText('Rol de Persona 1'), 'recepcion');
    await userEvent.click(within(fila).getByRole('checkbox'));
    await userEvent.click(within(fila).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El consultorio necesita al menos un administrador');
    const fd = acciones.editarMiembro.mock.calls[0]?.[1] as FormData;
    expect(fd.get('usuarioId')).toBe(miembros[0]?.usuarioId);
    expect(fd.get('rol')).toBe('recepcion');
    expect(fd.get('admin')).toBeNull();
  });

  test('reiniciar contraseña pide una temporal y la muestra una vez', async () => {
    acciones.reiniciarPassword.mockResolvedValueOnce({ ok: true, passwordTemporal: 'Otra-Temporal-1' });
    render(<TablaMiembros miembros={miembros} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Reiniciar contraseña' })[1] as HTMLElement);
    const dialogo = await screen.findByRole('dialog');
    await userEvent.type(within(dialogo).getByLabelText('Contraseña temporal'), 'Otra-Temporal-1');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Reiniciar contraseña' }));
    expect(await within(dialogo).findByRole('status')).toHaveTextContent('Otra-Temporal-1');
    const fd = acciones.reiniciarPassword.mock.calls[0]?.[1] as FormData;
    expect(fd.get('usuarioId')).toBe(miembros[1]?.usuarioId);
  });

  test('al cerrar y reabrir el diálogo la contraseña temporal ya no se ve', async () => {
    acciones.reiniciarPassword.mockResolvedValueOnce({ ok: true, passwordTemporal: 'Otra-Temporal-1' });
    render(<TablaMiembros miembros={[miembros[1] as Miembro]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar contraseña' }));
    let dialogo = await screen.findByRole('dialog');
    await userEvent.type(within(dialogo).getByLabelText('Contraseña temporal'), 'Otra-Temporal-1');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Reiniciar contraseña' }));
    expect(await within(dialogo).findByRole('status')).toHaveTextContent('Otra-Temporal-1');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar contraseña' }));
    dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Otra-Temporal-1/)).not.toBeInTheDocument();
  });

  test('reiniciar contraseña muestra el error de la API', async () => {
    acciones.reiniciarPassword.mockResolvedValueOnce({ mensaje: 'La cuenta también pertenece a otro consultorio' });
    render(<TablaMiembros miembros={[miembros[1] as Miembro]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reiniciar contraseña' }));
    const dialogo = await screen.findByRole('dialog');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Reiniciar contraseña' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('otro consultorio');
  });

  test('quitar pide confirmación; cancelar no llama y confirmar sí', async () => {
    acciones.quitarMiembro.mockResolvedValueOnce({ mensaje: 'El consultorio necesita al menos un administrador' });
    render(<TablaMiembros miembros={miembros} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0] as HTMLElement);
    let dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('¿Quitar a Persona 1 del consultorio?');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(acciones.quitarMiembro).not.toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0] as HTMLElement);
    dialogo = await screen.findByRole('dialog');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, quitar' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('El consultorio necesita al menos un administrador');
    expect((acciones.quitarMiembro.mock.calls[0]?.[1] as FormData).get('usuarioId')).toBe(miembros[0]?.usuarioId);
  });
});
