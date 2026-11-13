import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const acciones = vi.hoisted(() => ({ guardarPersonalizacion: vi.fn(), subirLogo: vi.fn(), quitarLogo: vi.fn() }));
vi.mock('@/features/consultorio/actions', () => acciones);
vi.mock('next/navigation', () => ({ usePathname: () => '/agenda' }));
vi.mock('@/features/sesion/actions', () => ({ cerrarSesion: vi.fn() }));

const { FormularioPersonalizacion } = await import('@/features/consultorio/components/FormularioPersonalizacion');
const { SeccionLogo } = await import('@/features/consultorio/components/SeccionLogo');
const { BarraDeNavegacion } = await import('@/features/navegacion/components/BarraDeNavegacion');

const consultorio = {
  id: '0190a0a0-0000-7000-8000-00000000000a',
  nombre: 'Dental Sol',
  slug: 'dental-sol',
  zonaHoraria: 'America/Mexico_City',
  nombreComercial: null,
  direccion: null,
  telefono: null,
  colorPrimario: null,
  colorTexto: null,
  logoVersion: 0,
  pais: 'MX' as const,
  moneda: 'MXN' as const,
};

beforeEach(() => {
  for (const f of Object.values(acciones)) f.mockReset();
});
afterEach(cleanup);

describe('FormularioPersonalizacion', () => {
  test('SelectorColor: amarillo pálido muestra "Elige un color más oscuro" y deshabilita guardar', async () => {
    render(<FormularioPersonalizacion consultorio={consultorio} />);
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(guardar).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Otro color'), { target: { value: '#ffff99' } });

    expect(screen.getByText('Elige un color más oscuro')).toBeInTheDocument();
    expect(guardar).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Color #1d4ed8' }));
    expect(screen.queryByText('Elige un color más oscuro')).not.toBeInTheDocument();
    expect(guardar).toBeEnabled();
  });

  test('elegir de la paleta pone el color en el campo enviado y en la vista previa; se puede volver al predeterminado', async () => {
    const { container } = render(<FormularioPersonalizacion consultorio={consultorio} />);
    await userEvent.click(screen.getByRole('button', { name: 'Color #0f766e' }));
    expect(container.querySelector('input[name="colorPrimario"]')).toHaveValue('#0f766e');
    expect(screen.getByTestId('vista-previa')).toHaveStyle({ '--primary': '#0f766e' });

    await userEvent.click(screen.getByRole('button', { name: 'Usar el color predeterminado' }));
    expect(container.querySelector('input[name="colorPrimario"]')).toHaveValue('');
  });

  test('la vista previa sigue el nombre comercial que se escribe y cae al nombre del consultorio', async () => {
    render(<FormularioPersonalizacion consultorio={consultorio} />);
    const vista = screen.getByTestId('vista-previa');
    expect(vista).toHaveTextContent('Dental Sol');
    await userEvent.type(screen.getByLabelText('Nombre comercial'), 'Sonrisas');
    expect(vista).toHaveTextContent('Sonrisas');
  });

  test('envía el formulario a la acción y muestra errores por campo y la confirmación', async () => {
    acciones.guardarPersonalizacion.mockResolvedValueOnce({ errores: { telefono: 'Teléfono inválido' }, valores: { telefono: '123' } });
    render(<FormularioPersonalizacion consultorio={consultorio} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Teléfono inválido')).toBeInTheDocument();
    expect(acciones.guardarPersonalizacion).toHaveBeenCalledTimes(1);

    acciones.guardarPersonalizacion.mockResolvedValueOnce({ ok: true });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
  });
});

describe('SeccionLogo', () => {
  const archivoDe = (n: number, type: string) => new File([new Uint8Array(n)], 'logo', { type });

  test('sin logo no hay imagen ni "Quitar"; con logo muestra la imagen versionada', () => {
    const { rerender } = render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={0} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    rerender(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={3} />);
    expect(screen.getByRole('img', { name: 'Logo de Dental Sol' })).toHaveAttribute('src', `/consultorio/logo?c=${consultorio.id}&v=3`);
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument();
  });

  test('un archivo de 1.5 MB se rechaza en el cliente sin enviar nada', async () => {
    const { container } = render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={0} />);
    const entrada = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(entrada, archivoDe(1_500_000, 'image/png'), { applyAccept: false });
    expect(await screen.findByText('El logo debe pesar menos de 1 MB')).toBeInTheDocument();
    expect(acciones.subirLogo).not.toHaveBeenCalled();
  });

  test('un tipo no permitido se rechaza en el cliente', async () => {
    const { container } = render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={0} />);
    const entrada = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(entrada, archivoDe(10, 'image/gif'), { applyAccept: false });
    expect(await screen.findByText('Sube una imagen PNG, JPG o WebP')).toBeInTheDocument();
    expect(acciones.subirLogo).not.toHaveBeenCalled();
  });

  test('un archivo válido se envía a la acción', async () => {
    acciones.subirLogo.mockResolvedValue({ ok: true });
    const { container } = render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={0} />);
    const entrada = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(entrada, archivoDe(100, 'image/png'));
    await waitFor(() => expect(acciones.subirLogo).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Logo actualizado')).toBeInTheDocument();
  });

  test('tras elegir un archivo se vacía el selector: el mismo archivo se puede elegir otra vez', async () => {
    acciones.subirLogo.mockResolvedValue({ ok: true });
    const { container } = render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={0} />);
    const entrada = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(entrada, archivoDe(100, 'image/png'));
    await waitFor(() => expect(acciones.subirLogo).toHaveBeenCalledTimes(1));
    expect(entrada.files).toHaveLength(0);
    await userEvent.upload(entrada, archivoDe(100, 'image/png'));
    await waitFor(() => expect(acciones.subirLogo).toHaveBeenCalledTimes(2));
  });

  test('"Cambiar" abre el selector de archivos', async () => {
    const { container } = render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={0} />);
    const entrada = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clic = vi.spyOn(entrada, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(clic).toHaveBeenCalled();
  });

  test('"Quitar" llama a quitarLogo y muestra su error', async () => {
    acciones.quitarLogo.mockResolvedValue({ mensaje: 'Ocurrió un error. Intenta de nuevo.' });
    render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={2} />);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error. Intenta de nuevo.');
    expect(acciones.quitarLogo).toHaveBeenCalled();
  });

  test('Review Focus 5: logo quitado (logoVersion>0 pero 404) → la imagen se oculta', () => {
    render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={2} />);
    fireEvent.error(screen.getByRole('img', { name: 'Logo de Dental Sol' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('BarraDeNavegacion con el consultorio personalizado', () => {
  test('dos consultorios con la misma versión piden URL distinta', () => {
    const { rerender } = render(<BarraDeNavegacion opciones={[]} consultorio="A" consultorioId="id-a" logoVersion={1} />);
    const a = screen.getByRole('img').getAttribute('src');
    rerender(<BarraDeNavegacion opciones={[]} consultorio="B" consultorioId="id-b" logoVersion={1} />);
    expect(screen.getByRole('img').getAttribute('src')).not.toBe(a);
  });

  test('tras un error de carga, un logo nuevo (otra versión) vuelve a mostrarse', () => {
    const { rerender } = render(<BarraDeNavegacion opciones={[]} consultorio="Sonrisas" consultorioId={consultorio.id} logoVersion={4} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    rerender(<BarraDeNavegacion opciones={[]} consultorio="Sonrisas" consultorioId={consultorio.id} logoVersion={5} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe(`/consultorio/logo?c=${consultorio.id}&v=5`);
  });


  test('con logoVersion > 0 muestra el logo versionado junto al nombre', () => {
    render(<BarraDeNavegacion opciones={[]} consultorio="Sonrisas" consultorioId={consultorio.id} logoVersion={4} />);
    expect(screen.getByRole('img', { name: 'Logo de Sonrisas' })).toHaveAttribute('src', `/consultorio/logo?c=${consultorio.id}&v=4`);
    expect(screen.getByText('Sonrisas')).toBeInTheDocument();
  });

  test('sin logo (logoVersion 0) no hay imagen', () => {
    render(<BarraDeNavegacion opciones={[]} consultorio="Sonrisas" consultorioId={consultorio.id} logoVersion={0} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('Review Focus 5: si la imagen falla al cargar se oculta y queda el nombre', () => {
    render(<BarraDeNavegacion opciones={[]} consultorio="Sonrisas" consultorioId={consultorio.id} logoVersion={4} />);
    fireEvent.error(screen.getByRole('img', { name: 'Logo de Sonrisas' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Sonrisas')).toBeInTheDocument();
  });
});

describe('SeccionLogo con el almacenamiento caído (spec §5)', () => {
  test('si el logo no carga, avisa con un texto genérico y deja "Quitar"', () => {
    render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={2} />);
    expect(screen.queryByText('No se pudo cargar el logo en este momento. Intenta más tarde.')).not.toBeInTheDocument();
    fireEvent.error(screen.getByRole('img', { name: 'Logo de Dental Sol' }));
    expect(screen.getByText('No se pudo cargar el logo en este momento. Intenta más tarde.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument();
  });

  test('un logo nuevo (otra versión) quita el aviso y vuelve a intentar', () => {
    const { rerender } = render(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={2} />);
    fireEvent.error(screen.getByRole('img'));
    rerender(<SeccionLogo nombre="Dental Sol" consultorioId={consultorio.id} logoVersion={3} />);
    expect(screen.queryByText(/No se pudo cargar el logo/)).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', `/consultorio/logo?c=${consultorio.id}&v=3`);
  });

  test('el encabezado sigue ocultando el logo en silencio', () => {
    render(<BarraDeNavegacion opciones={[]} consultorio="Sonrisas" consultorioId={consultorio.id} logoVersion={4} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByText(/No se pudo cargar el logo/)).not.toBeInTheDocument();
  });
});

describe('FormularioPersonalizacion: teléfono con prefijo del país y longitudes', () => {
  test('muestra el prefijo del país y, de un teléfono guardado, solo los dígitos nacionales', () => {
    render(<FormularioPersonalizacion consultorio={{ ...consultorio, telefono: '+525512345678' }} />);
    expect(screen.getByText('+52')).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveValue('5512345678');
  });

  test('con Bolivia el prefijo es +591', () => {
    render(<FormularioPersonalizacion consultorio={{ ...consultorio, pais: 'BO', moneda: 'BOB', telefono: '+59171234567' }} />);
    expect(screen.getByText('+591')).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveValue('71234567');
  });

  test('los campos de texto tienen su longitud máxima', () => {
    render(<FormularioPersonalizacion consultorio={consultorio} />);
    expect(screen.getByLabelText('Nombre comercial')).toHaveAttribute('maxlength', '120');
    expect(screen.getByLabelText('Dirección')).toHaveAttribute('maxlength', '300');
  });

  test('un nombre comercial de 1 carácter muestra el error y deshabilita guardar', async () => {
    render(<FormularioPersonalizacion consultorio={consultorio} />);
    await userEvent.type(screen.getByLabelText('Nombre comercial'), 'A');
    expect(screen.getByText('El nombre comercial debe tener entre 2 y 120 caracteres')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Nombre comercial'), 'B');
    expect(screen.queryByText(/entre 2 y 120/)).not.toBeInTheDocument();
  });
});
