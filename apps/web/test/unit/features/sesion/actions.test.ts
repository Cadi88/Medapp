// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({
  llamarGateway: vi.fn(),
  guardarCookiesAuth: vi.fn(async () => undefined),
  guardarToken: vi.fn(async () => undefined),
  guardarConsultorio: vi.fn(async () => undefined),
  cerrarSesionCookies: vi.fn(async () => undefined),
  olvidarConsultorio: vi.fn(async () => undefined),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }) }));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));
vi.mock('@/lib/api/gateway', () => ({
  llamarGateway: m.llamarGateway,
  ipDelCliente: (h: Headers) => h.get('x-forwarded-for')?.split(',').at(-1)?.trim(),
}));
vi.mock('@/lib/sesion/cookies', () => ({
  guardarCookiesAuth: m.guardarCookiesAuth,
  guardarToken: m.guardarToken,
  guardarConsultorio: m.guardarConsultorio,
  cerrarSesion: m.cerrarSesionCookies,
  olvidarConsultorio: m.olvidarConsultorio,
}));

const acciones = await import('@/features/sesion/actions');

const TENANT = '0190a0a0-0000-7000-8000-000000000001';
const TENANT_2 = '0190a0a0-0000-7000-8000-000000000002';
const mio = (tenantId: string, nombre = 'Consultorio') => ({ tenantId, nombre, slug: 'c-' + nombre.toLowerCase(), rol: 'medico', admin: true });

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

/** El consultorio de una sesión anterior (PC compartida de recepción) se olvida antes de iniciar sesión. */
function olvidoAntesDelInicioDeSesion() {
  expect(m.olvidarConsultorio).toHaveBeenCalledTimes(1);
  const inicio = m.llamarGateway.mock.calls.findIndex(([r]) => r === '/api/identidad/auth/sign-in/email');
  expect(inicio).toBeGreaterThanOrEqual(0);
  expect(m.olvidarConsultorio.mock.invocationCallOrder[0]).toBeLessThan(m.llamarGateway.mock.invocationCallOrder[inicio]!);
}

/** Programa respuestas por ruta: `ruta → Resultado` (o función que lo calcula). */
function rutas(tabla: Record<string, unknown>) {
  m.llamarGateway.mockImplementation(async (ruta: string) => {
    const r = tabla[ruta];
    if (r === undefined) throw new Error(`ruta no simulada: ${ruta}`);
    return typeof r === 'function' ? (r as () => unknown)() : r;
  });
}
const llamadas = (ruta: string) => m.llamarGateway.mock.calls.filter(([r]) => r === ruta);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('iniciarSesion', () => {
  const cred = { email: 'ana@ejemplo.mx', password: 'una-clave-larga' };

  test('con twoFactorRedirect guarda las cookies y redirige a /login/mfa', async () => {
    rutas({ '/api/identidad/auth/sign-in/email': exito({ twoFactorRedirect: true }, ['better-auth.two_factor=abc; Path=/']) });

    await expect(acciones.iniciarSesion({}, formulario(cred))).rejects.toThrow('REDIRECT:/login/mfa');

    expect(m.guardarCookiesAuth).toHaveBeenCalledWith(['better-auth.two_factor=abc; Path=/']);
    const [, o] = llamadas('/api/identidad/auth/sign-in/email')[0] ?? [];
    expect(o).toMatchObject({ metodo: 'POST', cuerpo: cred, auth: 'ninguna', ip: '10.0.0.1' });
  });

  test('sin MFA guarda la sesión y continúa al consultorio', async () => {
    rutas({
      '/api/identidad/auth/sign-in/email': exito({ token: 't', user: {} }, ['better-auth.session_token=s']),
      '/api/identidad/tenants/mios': exito([mio(TENANT)]),
      '/api/identidad/sesion/tenant': exito({ token: 'jwt' }),
    });

    await expect(acciones.iniciarSesion({}, formulario(cred))).rejects.toThrow('REDIRECT:/agenda');
    expect(m.guardarCookiesAuth).toHaveBeenCalledWith(['better-auth.session_token=s']);
    olvidoAntesDelInicioDeSesion();
  });

  test('credenciales inválidas → "Correo o contraseña incorrectos" sin revelar cuál', async () => {
    rutas({ '/api/identidad/auth/sign-in/email': fallo(401, { code: 'NO_AUTENTICADO', message: 'Invalid email or password' }) });

    const r = await acciones.iniciarSesion({}, formulario(cred));

    expect(r).toEqual({ mensaje: 'Correo o contraseña incorrectos', valores: { email: cred.email } });
    expect(m.guardarCookiesAuth).not.toHaveBeenCalled();
  });

  test('datos inválidos → errores por campo sin llamar al gateway', async () => {
    const r = await acciones.iniciarSesion({}, formulario({ email: 'x', password: '' }));
    expect(r.errores).toEqual({ email: 'Escribe un correo válido', password: 'La contraseña es obligatoria' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('límite de intentos (429) y servidor caído (503) tienen su propio aviso', async () => {
    rutas({ '/api/identidad/auth/sign-in/email': fallo(429, { code: 'INTERNO', message: 'x' }) });
    expect((await acciones.iniciarSesion({}, formulario(cred))).mensaje).toMatch(/Demasiados intentos/);
    rutas({ '/api/identidad/auth/sign-in/email': fallo(503, { code: 'INTERNO', message: 'No se pudo contactar al servidor' }) });
    expect((await acciones.iniciarSesion({}, formulario(cred))).mensaje).toBe('No se pudo contactar al servidor');
  });
});

describe('verificarTotp', () => {
  test('código correcto → guarda cookies y continúa', async () => {
    rutas({
      '/api/identidad/auth/two-factor/verify-totp': exito({ token: 't' }, ['better-auth.session_token=s']),
      '/api/identidad/tenants/mios': exito([mio(TENANT)]),
      '/api/identidad/sesion/tenant': exito({ token: 'jwt' }),
    });

    await expect(acciones.verificarTotp({}, formulario({ codigo: '123 456' }))).rejects.toThrow('REDIRECT:/agenda');

    const [, o] = llamadas('/api/identidad/auth/two-factor/verify-totp')[0] ?? [];
    expect(o).toMatchObject({ metodo: 'POST', cuerpo: { code: '123456' }, auth: 'sesion' });
    expect(m.guardarCookiesAuth).toHaveBeenCalledWith(['better-auth.session_token=s']);
  });

  test('código incorrecto → error en el campo; código mal formado no llama al gateway', async () => {
    rutas({ '/api/identidad/auth/two-factor/verify-totp': fallo(401, { code: 'NO_AUTENTICADO', message: 'Invalid code' }) });
    expect((await acciones.verificarTotp({}, formulario({ codigo: '123456' }))).errores).toEqual({ codigo: 'Código incorrecto o vencido' });

    m.llamarGateway.mockClear();
    expect((await acciones.verificarTotp({}, formulario({ codigo: '12345' }))).errores?.codigo).toMatch(/6 dígitos/);
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('otro fallo → mensaje general', async () => {
    rutas({ '/api/identidad/auth/two-factor/verify-totp': fallo(503, { code: 'INTERNO', message: 'No se pudo contactar al servidor' }) });
    expect(await acciones.verificarTotp({}, formulario({ codigo: '123456' }))).toEqual({ mensaje: 'No se pudo contactar al servidor' });
  });
});

describe('continuarAConsultorio', () => {
  test('con un consultorio → guarda el consultorio y el token y va a /agenda', async () => {
    rutas({
      '/api/identidad/tenants/mios': exito([mio(TENANT)]),
      '/api/identidad/sesion/tenant': exito({ token: 'jwt.nuevo' }),
    });

    await expect(acciones.continuarAConsultorio()).rejects.toThrow('REDIRECT:/agenda');

    expect(m.guardarConsultorio).toHaveBeenCalledWith(TENANT);
    expect(m.guardarToken).toHaveBeenCalledWith('jwt.nuevo');
    const [, o] = llamadas('/api/identidad/sesion/tenant')[0] ?? [];
    expect(o).toMatchObject({ metodo: 'POST', cuerpo: { tenantId: TENANT }, auth: 'sesion' });
  });

  test('con varios consultorios → /elegir-consultorio sin pedir token', async () => {
    rutas({ '/api/identidad/tenants/mios': exito([mio(TENANT, 'A'), mio(TENANT_2, 'B')]) });

    await expect(acciones.continuarAConsultorio()).rejects.toThrow('REDIRECT:/elegir-consultorio');
    expect(m.guardarToken).not.toHaveBeenCalled();
  });

  test('sin consultorios → /sin-acceso', async () => {
    rutas({ '/api/identidad/tenants/mios': exito([]) });
    await expect(acciones.continuarAConsultorio()).rejects.toThrow('REDIRECT:/sin-acceso');
  });

  test('con PASSWORD_TEMPORAL → /cambiar-password', async () => {
    rutas({
      '/api/identidad/tenants/mios': exito([mio(TENANT)]),
      '/api/identidad/sesion/tenant': fallo(403, { code: 'PASSWORD_TEMPORAL', message: 'Debes cambiar tu contraseña temporal' }),
    });
    await expect(acciones.continuarAConsultorio()).rejects.toThrow('REDIRECT:/cambiar-password');
    expect(m.guardarToken).not.toHaveBeenCalled();
  });

  test('con MFA_REQUERIDA → /configurar-mfa', async () => {
    rutas({
      '/api/identidad/tenants/mios': exito([mio(TENANT)]),
      '/api/identidad/sesion/tenant': fallo(403, { code: 'MFA_REQUERIDA', message: 'MFA' }),
    });
    await expect(acciones.continuarAConsultorio()).rejects.toThrow('REDIRECT:/configurar-mfa');
  });

  test('sesión vencida al listar consultorios → /login', async () => {
    rutas({ '/api/identidad/tenants/mios': fallo(401, { code: 'NO_AUTENTICADO', message: 'No autenticado' }) });
    await expect(acciones.continuarAConsultorio()).rejects.toThrow('REDIRECT:/login');
  });

  test('error sin desvío → mensaje en pantalla', async () => {
    rutas({ '/api/identidad/tenants/mios': fallo(503, { code: 'INTERNO', message: 'No se pudo contactar al servidor' }) });
    expect(await acciones.continuarAConsultorio()).toEqual({ mensaje: 'No se pudo contactar al servidor' });
  });
});

describe('elegirConsultorio', () => {
  test('consultorio válido → token y /agenda', async () => {
    rutas({ '/api/identidad/sesion/tenant': exito({ token: 'jwt' }) });
    await expect(acciones.elegirConsultorio({}, formulario({ tenantId: TENANT_2 }))).rejects.toThrow('REDIRECT:/agenda');
    expect(m.guardarConsultorio).toHaveBeenCalledWith(TENANT_2);
    expect(m.guardarToken).toHaveBeenCalledWith('jwt');
  });

  test('sin elegir → error de campo; no miembro (403) → /sin-acceso', async () => {
    expect((await acciones.elegirConsultorio({}, formulario({}))).errores?.tenantId).toBeDefined();
    rutas({ '/api/identidad/sesion/tenant': fallo(403, { code: 'PROHIBIDO', message: 'No eres miembro' }) });
    await expect(acciones.elegirConsultorio({}, formulario({ tenantId: TENANT }))).rejects.toThrow('REDIRECT:/sin-acceso');
  });
});

describe('cambiarPassword', () => {
  const campos = { actual: 'temporal-12345', nueva: 'una-clave-larga', confirmacion: 'una-clave-larga' };

  test('envía revokeOtherSessions, guarda las cookies nuevas y continúa', async () => {
    rutas({
      '/api/identidad/auth/change-password': exito({}, ['better-auth.session_token=nueva']),
      '/api/identidad/tenants/mios': exito([mio(TENANT)]),
      '/api/identidad/sesion/tenant': exito({ token: 'jwt' }),
    });

    await expect(acciones.cambiarPassword({}, formulario(campos))).rejects.toThrow('REDIRECT:/agenda');

    const [, o] = llamadas('/api/identidad/auth/change-password')[0] ?? [];
    expect(o).toMatchObject({
      metodo: 'POST',
      cuerpo: { currentPassword: 'temporal-12345', newPassword: 'una-clave-larga', revokeOtherSessions: true },
      auth: 'sesion',
    });
    expect(m.guardarCookiesAuth).toHaveBeenCalledWith(['better-auth.session_token=nueva']);
  });

  test('contraseña actual incorrecta → error en "actual"; confirmación distinta no llama al gateway', async () => {
    rutas({ '/api/identidad/auth/change-password': fallo(400, { code: 'INTERNO', message: 'Invalid password' }) });
    expect((await acciones.cambiarPassword({}, formulario(campos))).errores).toEqual({ actual: 'La contraseña actual es incorrecta' });

    m.llamarGateway.mockClear();
    const r = await acciones.cambiarPassword({}, formulario({ ...campos, confirmacion: 'otra' }));
    expect(r.errores?.confirmacion).toMatch(/no coinciden/);
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('sesión vencida → /login; otro error → mensaje', async () => {
    rutas({ '/api/identidad/auth/change-password': fallo(401, { code: 'NO_AUTENTICADO', message: 'x' }) });
    await expect(acciones.cambiarPassword({}, formulario(campos))).rejects.toThrow('REDIRECT:/login');
    rutas({ '/api/identidad/auth/change-password': fallo(503, { code: 'INTERNO', message: 'No se pudo contactar al servidor' }) });
    expect((await acciones.cambiarPassword({}, formulario(campos))).mensaje).toBe('No se pudo contactar al servidor');
  });
});

describe('MFA', () => {
  test('iniciarConfiguracionMfa devuelve el QR como SVG y los códigos de respaldo', async () => {
    rutas({
      '/api/identidad/auth/two-factor/enable': exito({
        totpURI: 'otpauth://totp/Consultorio:ana%40ejemplo.mx?secret=JBSWY3DPEHPK3PXP&issuer=Consultorio',
        backupCodes: ['aaaa-bbbb', 'cccc-dddd'],
      }),
    });

    const r = await acciones.iniciarConfiguracionMfa({}, formulario({ password: 'una-clave-larga' }));

    expect(r.qrSvg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    expect(r.codigosRespaldo).toEqual(['aaaa-bbbb', 'cccc-dddd']);
    expect(r.claveManual).toBe('JBSWY3DPEHPK3PXP');
    const [, o] = llamadas('/api/identidad/auth/two-factor/enable')[0] ?? [];
    expect(o).toMatchObject({ metodo: 'POST', cuerpo: { password: 'una-clave-larga' }, auth: 'sesion' });
  });

  test('contraseña incorrecta o vacía → error en "password"', async () => {
    rutas({ '/api/identidad/auth/two-factor/enable': fallo(400, { code: 'INTERNO', message: 'Invalid password' }) });
    expect((await acciones.iniciarConfiguracionMfa({}, formulario({ password: 'mala' }))).errores).toEqual({ password: 'Contraseña incorrecta' });
    expect((await acciones.iniciarConfiguracionMfa({}, formulario({ password: '' }))).errores?.password).toBeDefined();
  });

  test('otros fallos al iniciar → mensaje; 401 → /login', async () => {
    rutas({ '/api/identidad/auth/two-factor/enable': fallo(503, { code: 'INTERNO', message: 'No se pudo contactar al servidor' }) });
    expect((await acciones.iniciarConfiguracionMfa({}, formulario({ password: 'x' }))).mensaje).toBe('No se pudo contactar al servidor');
    rutas({ '/api/identidad/auth/two-factor/enable': fallo(401, { code: 'NO_AUTENTICADO', message: 'x' }) });
    await expect(acciones.iniciarConfiguracionMfa({}, formulario({ password: 'x' }))).rejects.toThrow('REDIRECT:/login');
  });

  test('confirmarMfa verifica el código y continúa al consultorio', async () => {
    rutas({
      '/api/identidad/auth/two-factor/verify-totp': exito({ token: 't' }, ['better-auth.session_token=s']),
      '/api/identidad/tenants/mios': exito([mio(TENANT)]),
      '/api/identidad/sesion/tenant': exito({ token: 'jwt' }),
    });
    await expect(acciones.confirmarMfa({}, formulario({ codigo: '654321' }))).rejects.toThrow('REDIRECT:/agenda');
    expect(m.guardarCookiesAuth).toHaveBeenCalledWith(['better-auth.session_token=s']);
  });

  test('confirmarMfa con código incorrecto muestra el error', async () => {
    rutas({ '/api/identidad/auth/two-factor/verify-totp': fallo(401, { code: 'NO_AUTENTICADO', message: 'x' }) });
    expect((await acciones.confirmarMfa({}, formulario({ codigo: '654321' }))).errores).toEqual({ codigo: 'Código incorrecto o vencido' });
  });
});

describe('registrarConsultorio', () => {
  const campos = {
    nombreConsultorio: 'Dental Sol',
    slug: 'dental-sol',
    zonaHoraria: 'America/Mexico_City',
    esMedico: 'on',
    nombre: 'Ana López',
    email: 'ana@ejemplo.mx',
    password: 'una-clave-larga',
  };

  test('registra, inicia sesión y redirige a /configurar-mfa', async () => {
    rutas({
      '/api/identidad/registro': exito({ tenantId: TENANT, usuarioId: TENANT_2 }),
      '/api/identidad/auth/sign-in/email': exito({ token: 't' }, ['better-auth.session_token=s']),
    });

    await expect(acciones.registrarConsultorio({}, formulario(campos))).rejects.toThrow('REDIRECT:/configurar-mfa');

    const [, o] = llamadas('/api/identidad/registro')[0] ?? [];
    expect(o).toMatchObject({
      metodo: 'POST',
      auth: 'ninguna',
      cuerpo: {
        nombreConsultorio: 'Dental Sol',
        slug: 'dental-sol',
        zonaHoraria: 'America/Mexico_City',
        esMedico: true,
        admin: { nombre: 'Ana López', email: 'ana@ejemplo.mx', password: 'una-clave-larga' },
      },
    });
    expect(llamadas('/api/identidad/auth/sign-in/email')[0]?.[1]).toMatchObject({ cuerpo: { email: 'ana@ejemplo.mx', password: 'una-clave-larga' } });
    expect(m.guardarCookiesAuth).toHaveBeenCalledWith(['better-auth.session_token=s']);
    olvidoAntesDelInicioDeSesion();
  });

  test('sin marcar "soy médico" esMedico es false', async () => {
    rutas({
      '/api/identidad/registro': exito({ tenantId: TENANT, usuarioId: TENANT_2 }),
      '/api/identidad/auth/sign-in/email': exito({}, ['better-auth.session_token=s']),
    });
    const sinMedico: Record<string, string> = { ...campos };
    delete sinMedico.esMedico;
    await expect(acciones.registrarConsultorio({}, formulario(sinMedico))).rejects.toThrow('REDIRECT:/configurar-mfa');
    expect(llamadas('/api/identidad/registro')[0]?.[1]).toMatchObject({ cuerpo: { esMedico: false } });
  });

  test('conflicto de slug y de correo se muestran en su campo', async () => {
    rutas({ '/api/identidad/registro': fallo(409, { code: 'CONFLICTO', message: 'x', details: { campo: 'slug' } }) });
    expect((await acciones.registrarConsultorio({}, formulario(campos))).errores).toEqual({ slug: 'Ese identificador ya está en uso' });
    rutas({ '/api/identidad/registro': fallo(409, { code: 'CONFLICTO', message: 'x', details: { campo: 'email' } }) });
    expect((await acciones.registrarConsultorio({}, formulario(campos))).errores).toEqual({ email: 'Ese correo ya está registrado' });
  });

  test('validación local y otros errores', async () => {
    const r = await acciones.registrarConsultorio({}, formulario({ ...campos, slug: 'MAYUS' }));
    expect(r.errores?.slug).toMatch(/minúsculas/);
    expect(m.llamarGateway).not.toHaveBeenCalled();

    rutas({ '/api/identidad/registro': fallo(503, { code: 'INTERNO', message: 'No se pudo contactar al servidor' }) });
    expect((await acciones.registrarConsultorio({}, formulario(campos))).mensaje).toBe('No se pudo contactar al servidor');
  });

  test('cuenta creada pero el inicio de sesión falla → /login', async () => {
    rutas({
      '/api/identidad/registro': exito({ tenantId: TENANT, usuarioId: TENANT_2 }),
      '/api/identidad/auth/sign-in/email': fallo(503, { code: 'INTERNO', message: 'x' }),
    });
    await expect(acciones.registrarConsultorio({}, formulario(campos))).rejects.toThrow('REDIRECT:/login');
  });
});

describe('cerrarSesion', () => {
  test('llama a sign-out, borra las cookies y va a /login aunque el gateway falle', async () => {
    rutas({ '/api/identidad/auth/sign-out': fallo(503, { code: 'INTERNO', message: 'x' }) });

    await expect(acciones.cerrarSesion()).rejects.toThrow('REDIRECT:/login');

    expect(llamadas('/api/identidad/auth/sign-out')[0]?.[1]).toMatchObject({ metodo: 'POST', auth: 'sesion' });
    expect(m.cerrarSesionCookies).toHaveBeenCalled();
  });
});
