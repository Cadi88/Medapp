import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const acciones = vi.hoisted(() => ({ guardarPerfilMedico: vi.fn(), cambiarPassword: vi.fn() }));
vi.mock('@/features/perfil/actions', () => ({ guardarPerfilMedico: acciones.guardarPerfilMedico }));
vi.mock('@/features/sesion/actions', () => ({ cambiarPassword: acciones.cambiarPassword }));

const { FormularioPerfilMedico } = await import('@/features/perfil/components/FormularioPerfilMedico');
const { FormularioPasswordPerfil } = await import('@/features/perfil/components/FormularioPasswordPerfil');

beforeEach(() => {
  acciones.guardarPerfilMedico.mockReset();
  acciones.cambiarPassword.mockReset();
});
afterEach(cleanup);

describe('FormularioPerfilMedico', () => {
  test('parte de los datos guardados (nulos como vacío) y envía los campos', async () => {
    acciones.guardarPerfilMedico.mockResolvedValueOnce({ ok: true });
    render(<FormularioPerfilMedico perfil={{ cedulaProfesional: '1234567', especialidad: 'Pediatría', cedulaEspecialidad: null, institucion: null }} />);
    expect(screen.getByLabelText('Cédula profesional')).toHaveValue('1234567');
    expect(screen.getByLabelText('Especialidad')).toHaveValue('Pediatría');
    expect(screen.getByLabelText('Institución')).toHaveValue('');

    await userEvent.type(screen.getByLabelText('Institución'), 'UNAM');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    expect(await screen.findByText('Perfil guardado')).toBeInTheDocument();
    const fd = acciones.guardarPerfilMedico.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(fd.entries())).toEqual({ cedulaProfesional: '1234567', especialidad: 'Pediatría', cedulaEspecialidad: '', institucion: 'UNAM' });
  });

  test('sin perfil previo los campos están vacíos y muestra los errores', async () => {
    acciones.guardarPerfilMedico.mockResolvedValueOnce({ errores: { cedulaProfesional: 'La cédula profesional debe tener 7 u 8 dígitos' }, valores: { cedulaProfesional: '12' } });
    render(<FormularioPerfilMedico perfil={null} />);
    expect(screen.getByLabelText('Cédula profesional')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    expect(await screen.findByText('La cédula profesional debe tener 7 u 8 dígitos')).toBeInTheDocument();
    expect(screen.getByLabelText('Cédula profesional')).toHaveValue('12');
  });

  test('error general de la API', async () => {
    acciones.guardarPerfilMedico.mockResolvedValueOnce({ mensaje: 'Ocurrió un error. Intenta de nuevo.' });
    render(<FormularioPerfilMedico perfil={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error');
  });
});

describe('FormularioPasswordPerfil', () => {
  test('reutiliza la acción de cambio de contraseña y muestra sus errores', async () => {
    acciones.cambiarPassword.mockResolvedValueOnce({ errores: { actual: 'La contraseña actual es incorrecta' } });
    render(<FormularioPasswordPerfil />);
    await userEvent.type(screen.getByLabelText('Contraseña actual'), 'vieja-password');
    await userEvent.type(screen.getByLabelText('Contraseña nueva'), 'nueva-password-1');
    await userEvent.type(screen.getByLabelText('Confirma la contraseña nueva'), 'nueva-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('La contraseña actual es incorrecta')).toBeInTheDocument();
    const fd = acciones.cambiarPassword.mock.calls[0]?.[1] as FormData;
    expect(fd.get('nueva')).toBe('nueva-password-1');
  });

  test('error general', async () => {
    acciones.cambiarPassword.mockResolvedValueOnce({ mensaje: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' });
    render(<FormularioPasswordPerfil />);
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos');
  });
});
