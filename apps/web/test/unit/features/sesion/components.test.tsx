import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { EstadoConfiguracionMfa, EstadoFormulario } from '@/features/sesion/tipos';

const acciones = vi.hoisted(() => ({
  iniciarSesion: vi.fn(),
  verificarTotp: vi.fn(),
  registrarConsultorio: vi.fn(),
  cambiarPassword: vi.fn(),
  iniciarConfiguracionMfa: vi.fn(),
  confirmarMfa: vi.fn(),
  elegirConsultorio: vi.fn(),
  cerrarSesion: vi.fn(),
}));
vi.mock('@/features/sesion/actions', () => acciones);

const { FormularioLogin } = await import('@/features/sesion/components/formulario-login');
const { FormularioTotp } = await import('@/features/sesion/components/formulario-totp');
const { FormularioRegistro } = await import('@/features/sesion/components/formulario-registro');
const { FormularioCambiarPassword } = await import('@/features/sesion/components/formulario-cambiar-password');
const { ConfigurarMfa } = await import('@/features/sesion/components/configurar-mfa');
const { SelectorConsultorio } = await import('@/features/sesion/components/selector-consultorio');
const { BotonCerrarSesion } = await import('@/features/sesion/components/boton-cerrar-sesion');

beforeEach(() => {
  for (const f of Object.values(acciones)) f.mockReset();
});
afterEach(cleanup);

const enviar = async (nombre: RegExp) => userEvent.click(screen.getByRole('button', { name: nombre }));

describe('FormularioLogin', () => {
  test('muestra errores por campo y deshabilita el botón al enviar', async () => {
    let resolver: (e: EstadoFormulario) => void = () => undefined;
    acciones.iniciarSesion.mockImplementationOnce(() => new Promise<EstadoFormulario>((r) => (resolver = r)));
    render(<FormularioLogin />);

    const boton = screen.getByRole('button', { name: 'Iniciar sesión' });
    expect(boton).toBeEnabled();
    await userEvent.click(boton);

    await waitFor(() => expect(screen.getByRole('button', { name: /Entrando/ })).toBeDisabled());

    resolver({ errores: { email: 'Escribe un correo válido', password: 'La contraseña es obligatoria' }, valores: { email: 'x' } });

    expect(await screen.findByText('Escribe un correo válido')).toBeInTheDocument();
    expect(screen.getByText('La contraseña es obligatoria')).toBeInTheDocument();
    const correo = screen.getByLabelText('Correo electrónico');
    expect(correo).toHaveAttribute('aria-invalid', 'true');
    expect(correo).toHaveValue('x');
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  });

  test('un mensaje general (credenciales inválidas) se anuncia como alerta', async () => {
    acciones.iniciarSesion.mockResolvedValueOnce({ mensaje: 'Correo o contraseña incorrectos' });
    render(<FormularioLogin />);
    await enviar(/Iniciar sesión/);
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos');
  });

  test('enlaza al registro', () => {
    render(<FormularioLogin />);
    expect(screen.getByRole('link', { name: /Registra tu consultorio/ })).toHaveAttribute('href', '/registro');
  });
});

describe('FormularioTotp', () => {
  test('pide el código de 6 dígitos y muestra el error del campo', async () => {
    acciones.verificarTotp.mockResolvedValueOnce({ errores: { codigo: 'Código incorrecto o vencido' } });
    render(<FormularioTotp />);
    expect(screen.getByLabelText('Código de verificación')).toHaveAttribute('inputmode', 'numeric');
    await enviar(/Verificar/);
    expect(await screen.findByText('Código incorrecto o vencido')).toBeInTheDocument();
  });

  test('ofrece volver a iniciar sesión', () => {
    render(<FormularioTotp />);
    expect(screen.getByRole('link', { name: 'Volver a iniciar sesión' })).toHaveAttribute('href', '/login');
  });
});

describe('FormularioRegistro', () => {
  test('la zona horaria ofrece solo America/* con Ciudad de México por omisión', () => {
    render(<FormularioRegistro />);
    const zona = screen.getByLabelText('Zona horaria') as HTMLSelectElement;
    expect(zona.value).toBe('America/Mexico_City');
    const valores = [...zona.options].map((o) => o.value);
    expect(valores.length).toBeGreaterThan(10);
    expect(valores.every((v) => v.startsWith('America/'))).toBe(true);
  });

  test('muestra el error del identificador y conserva lo escrito', async () => {
    acciones.registrarConsultorio.mockResolvedValueOnce({
      errores: { slug: 'Ese identificador ya está en uso' },
      valores: { nombreConsultorio: 'Dental Sol', slug: 'dental-sol', zonaHoraria: 'America/Bogota', nombre: 'Ana', email: 'ana@ejemplo.mx', esMedico: 'on' },
    });
    render(<FormularioRegistro />);
    await enviar(/Crear cuenta/);
    expect(await screen.findByText('Ese identificador ya está en uso')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del consultorio')).toHaveValue('Dental Sol');
    expect(screen.getByLabelText('Zona horaria')).toHaveValue('America/Bogota');
    expect(screen.getByLabelText(/Soy médico/)).toBeChecked();
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
  });
});

describe('FormularioCambiarPassword', () => {
  test('muestra el error de la contraseña actual', async () => {
    acciones.cambiarPassword.mockResolvedValueOnce({ errores: { actual: 'La contraseña actual es incorrecta' } });
    render(<FormularioCambiarPassword />);
    await enviar(/Cambiar contraseña/);
    expect(await screen.findByText('La contraseña actual es incorrecta')).toBeInTheDocument();
  });
});

describe('ConfigurarMfa', () => {
  test('muestra el QR y los códigos de respaldo y pide confirmar con un código', async () => {
    const estado: EstadoConfiguracionMfa = {
      qrSvg: '<svg data-testid="qr" xmlns="http://www.w3.org/2000/svg"></svg>',
      codigosRespaldo: ['aaaa-bbbb', 'cccc-dddd'],
    };
    acciones.iniciarConfiguracionMfa.mockResolvedValueOnce(estado);
    render(<ConfigurarMfa />);

    expect(screen.queryByTestId('qr')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Contraseña'), 'una-clave-larga');
    await enviar(/Generar código QR/);

    expect(await screen.findByTestId('qr')).toBeInTheDocument();
    expect(screen.getByText('aaaa-bbbb')).toBeInTheDocument();
    expect(screen.getByText('cccc-dddd')).toBeInTheDocument();
    expect(screen.getByLabelText('Código de verificación')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar y continuar/ })).toBeInTheDocument();
  });

  test('error de contraseña en el primer paso', async () => {
    acciones.iniciarConfiguracionMfa.mockResolvedValueOnce({ errores: { password: 'Contraseña incorrecta' } });
    render(<ConfigurarMfa />);
    await enviar(/Generar código QR/);
    expect(await screen.findByText('Contraseña incorrecta')).toBeInTheDocument();
    expect(screen.queryByLabelText('Código de verificación')).not.toBeInTheDocument();
  });

  test('error al confirmar el código', async () => {
    acciones.iniciarConfiguracionMfa.mockResolvedValueOnce({ qrSvg: '<svg></svg>', codigosRespaldo: ['x'] });
    acciones.confirmarMfa.mockResolvedValueOnce({ errores: { codigo: 'Código incorrecto o vencido' } });
    render(<ConfigurarMfa />);
    await enviar(/Generar código QR/);
    await screen.findByLabelText('Código de verificación');
    await enviar(/Confirmar y continuar/);
    expect(await screen.findByText('Código incorrecto o vencido')).toBeInTheDocument();
  });
});

describe('SelectorConsultorio', () => {
  const consultorios = [
    { tenantId: '0190a0a0-0000-7000-8000-000000000001', nombre: 'Dental Sol', slug: 'dental-sol', rol: 'medico' as const, admin: true },
    { tenantId: '0190a0a0-0000-7000-8000-000000000002', nombre: 'Clínica Luna', slug: 'luna', rol: 'recepcion' as const, admin: false },
  ];

  test('lista cada consultorio con su rol y envía el elegido', async () => {
    acciones.elegirConsultorio.mockResolvedValue({});
    render(<SelectorConsultorio consultorios={consultorios} />);

    expect(screen.getByText('Dental Sol')).toBeInTheDocument();
    expect(screen.getByText(/Médico · Administrador/)).toBeInTheDocument();
    expect(screen.getByText(/Recepción/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Clínica Luna/ }));
    await waitFor(() => expect(acciones.elegirConsultorio).toHaveBeenCalled());
    const fd = acciones.elegirConsultorio.mock.calls[0]?.[1] as FormData;
    expect(fd.get('tenantId')).toBe(consultorios[1]?.tenantId);
  });

  test('muestra el mensaje de error', async () => {
    acciones.elegirConsultorio.mockResolvedValueOnce({ mensaje: 'No se pudo contactar al servidor' });
    render(<SelectorConsultorio consultorios={consultorios} />);
    await userEvent.click(screen.getByRole('button', { name: /Dental Sol/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar al servidor');
  });
});

describe('BotonCerrarSesion', () => {
  test('envía el formulario de cierre de sesión', async () => {
    acciones.cerrarSesion.mockResolvedValue(undefined);
    render(<BotonCerrarSesion />);
    await enviar(/Cerrar sesión/);
    await waitFor(() => expect(acciones.cerrarSesion).toHaveBeenCalled());
  });
});
