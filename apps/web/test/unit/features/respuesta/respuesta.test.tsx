import '@testing-library/jest-dom/vitest';
import type { RespuestaPublica } from '@consultorio/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { accionInicial } from '@/features/respuesta/logica/enlace';

const m = vi.hoisted(() => ({ enviarRespuesta: vi.fn() }));
vi.mock('@/features/respuesta/actions', () => ({ enviarRespuesta: m.enviarRespuesta }));

const { PaginaRespuesta } = await import('@/features/respuesta/components/PaginaRespuesta');

const TOKEN = 'abc_DEF-123';
const vigente: RespuestaPublica = {
  estado: 'vigente',
  consultorio: { nombre: 'Dental Sol', tieneLogo: true },
  fecha: 'martes 17 de noviembre',
  hora: '10:00',
  medico: 'Dra. Ruiz',
  telefonoConsultorio: '+525512345678',
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('accionInicial', () => {
  test.each([
    ['confirma', 'confirma'],
    ['cancela', 'cancela'],
    ['pide_cambio', 'pide_cambio'],
    ['borrar', undefined],
    [undefined, undefined],
    [['cancela', 'confirma'], 'cancela'],
    [[], undefined],
  ])('%j → %s', (entrada, esperado) => {
    expect(accionInicial(entrada)).toBe(esperado);
  });
});

describe('PaginaRespuesta', () => {
  test('enlace inválido: "Este enlace ya no es válido" y nada más', () => {
    render(<PaginaRespuesta token={TOKEN} enlace={{ estado: 'invalida' }} />);
    expect(screen.getByText('Este enlace ya no es válido')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('ya respondida: el texto exacto y el teléfono del consultorio', () => {
    render(<PaginaRespuesta token={TOKEN} enlace={{ estado: 'respondida', consultorio: { nombre: 'Dental Sol', tieneLogo: false }, telefonoConsultorio: '+525512345678' }} />);
    expect(screen.getByText('Esta cita ya fue respondida. Si necesitas otro cambio, llama al consultorio')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+525512345678' })).toHaveAttribute('href', 'tel:+525512345678');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('ya respondida sin teléfono: solo el texto', () => {
    render(<PaginaRespuesta token={TOKEN} enlace={{ estado: 'respondida' }} />);
    expect(screen.getByText('Esta cita ya fue respondida. Si necesitas otro cambio, llama al consultorio')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('vigente: consultorio, fecha, hora y médico; logo por la ruta pública que se oculta si falla', () => {
    render(<PaginaRespuesta token={TOKEN} enlace={vigente} />);
    expect(screen.getByRole('heading', { name: 'Dental Sol' })).toBeInTheDocument();
    expect(screen.getByText('martes 17 de noviembre')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('Dra. Ruiz')).toBeInTheDocument();
    const logo = screen.getByRole('img', { name: 'Logo de Dental Sol' });
    expect(logo).toHaveAttribute('src', `/r/${TOKEN}/logo`);
    fireEvent.error(logo);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('sin logo no dibuja imagen', () => {
    render(<PaginaRespuesta token={TOKEN} enlace={{ ...vigente, consultorio: { nombre: 'Dental Sol', tieneLogo: false } }} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('?accion solo preselecciona: sin clic en "Enviar respuesta" no se llama a la acción', () => {
    render(<PaginaRespuesta token={TOKEN} enlace={vigente} accion="cancela" />);
    expect(screen.getByRole('radio', { name: 'Cancelar mi cita' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Confirmar mi cita' })).not.toBeChecked();
    expect(m.enviarRespuesta).not.toHaveBeenCalled();
  });

  test('sin selección el botón de envío no se puede usar', () => {
    render(<PaginaRespuesta token={TOKEN} enlace={vigente} />);
    expect(screen.getByRole('button', { name: 'Enviar respuesta' })).toBeDisabled();
  });

  test('al enviar manda token y la opción elegida y da las gracias', async () => {
    m.enviarRespuesta.mockResolvedValue({ estado: 'registrada' });
    render(<PaginaRespuesta token={TOKEN} enlace={vigente} accion="cancela" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Pedir cambio de horario' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
    const [, fd] = m.enviarRespuesta.mock.calls[0] as [unknown, FormData];
    expect(fd.get('token')).toBe(TOKEN);
    expect(fd.get('respuesta')).toBe('pide_cambio');
    expect(await screen.findByText('Gracias, recibimos tu respuesta')).toBeInTheDocument();
  });

  test('si mientras tanto ya se respondió o venció, muestra el texto que corresponde', async () => {
    m.enviarRespuesta.mockResolvedValueOnce({ estado: 'respondida' });
    const { unmount } = render(<PaginaRespuesta token={TOKEN} enlace={vigente} accion="confirma" />);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
    expect(await screen.findByText('Esta cita ya fue respondida. Si necesitas otro cambio, llama al consultorio')).toBeInTheDocument();
    unmount();

    m.enviarRespuesta.mockResolvedValueOnce({ estado: 'invalida' });
    render(<PaginaRespuesta token={TOKEN} enlace={vigente} accion="confirma" />);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
    expect(await screen.findByText('Este enlace ya no es válido')).toBeInTheDocument();
  });

  test('un error de la acción se muestra y deja volver a intentar', async () => {
    m.enviarRespuesta.mockResolvedValue({ mensaje: 'No pudimos registrar tu respuesta. Intenta de nuevo.' });
    render(<PaginaRespuesta token={TOKEN} enlace={vigente} accion="confirma" />);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar respuesta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos registrar tu respuesta. Intenta de nuevo.');
    expect(screen.getByRole('button', { name: 'Enviar respuesta' })).toBeEnabled();
  });
});
