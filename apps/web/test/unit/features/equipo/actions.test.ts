// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { altaMiembroRespuestaSchema } from '@consultorio/contracts';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ llamarGateway: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '9.9.9.9' }) }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/api/gateway', () => ({ llamarGateway: m.llamarGateway, ipDelCliente: (h: Headers) => h.get('x-forwarded-for') ?? undefined }));

const acciones = await import('@/features/equipo/actions');
const { listarMiembros } = await import('@/features/equipo/api');

const USUARIO = '0190a0a0-0000-7000-8000-00000000000a';
const formulario = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
const error = (code: string) => ({ code, message: 'x' }) as never;
const ULTIMO_ADMIN = 'El consultorio necesita al menos un administrador';

beforeEach(() => {
  m.llamarGateway.mockReset();
  m.revalidatePath.mockReset();
});

describe('listarMiembros', () => {
  test('devuelve la lista del contrato', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ miembros: [] }));
    expect(await listarMiembros()).toEqual({ ok: true, datos: [] });
    expect(m.llamarGateway.mock.calls[0]?.[0]).toBe('/api/identidad/miembros');
  });

  test('propaga el error', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(500, error('INTERNO')));
    expect((await listarMiembros()).ok).toBe(false);
  });
});

describe('altaMiembro', () => {
  const campos = { nombre: ' Luis Mora ', email: 'luis@ejemplo.mx', rol: 'recepcion', admin: 'on', passwordTemporal: 'Temporal-2026!' };

  const creada = (cuentaCreada: boolean) => exito({ usuarioId: USUARIO, rol: 'recepcion', admin: true, cuentaCreada });

  test('envía el alta, revalida y devuelve la contraseña temporal una sola vez', async () => {
    m.llamarGateway.mockResolvedValueOnce(creada(true));
    const r = await acciones.altaMiembro({}, formulario(campos));
    expect(r).toEqual({ ok: true, passwordTemporal: 'Temporal-2026!' });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([
      '/api/identidad/miembros',
      { metodo: 'POST', auth: 'token', cuerpo: { nombre: 'Luis Mora', email: 'luis@ejemplo.mx', rol: 'recepcion', admin: true, passwordTemporal: 'Temporal-2026!' } },
    ]);
    expect(m.llamarGateway.mock.calls[0]?.[1]).toMatchObject({ esquema: altaMiembroRespuestaSchema });
    expect(m.revalidatePath).toHaveBeenCalledWith('/equipo');
  });

  test('si la persona ya tenía cuenta (cuentaCreada: false) no devuelve la contraseña temporal: nunca se aplicó', async () => {
    m.llamarGateway.mockResolvedValueOnce(creada(false));
    const r = await acciones.altaMiembro({}, formulario(campos));
    expect(r).toEqual({ ok: true, cuentaExistente: true });
    expect(m.revalidatePath).toHaveBeenCalledWith('/equipo');
  });

  test('sin la casilla de admin envía admin=false', async () => {
    m.llamarGateway.mockResolvedValueOnce(creada(true));
    await acciones.altaMiembro({}, formulario({ ...campos, admin: '' }));
    expect(m.llamarGateway.mock.calls[0]?.[1]).toMatchObject({ cuerpo: { admin: false } });
  });

  test('datos inválidos: errores por campo, conserva lo escrito (menos la contraseña) y no llama', async () => {
    const r = await acciones.altaMiembro({}, formulario({ ...campos, nombre: '', email: 'x', passwordTemporal: 'corta' }));
    expect(r.errores).toMatchObject({
      nombre: 'El nombre es obligatorio',
      email: 'Escribe un correo válido',
      passwordTemporal: 'La contraseña debe tener al menos 10 caracteres',
    });
    expect(r.valores).toEqual({ nombre: '', email: 'x', rol: 'recepcion', admin: 'on' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('error de la API: mensaje, sin contraseña', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(409, error('CONFLICTO')));
    const r = await acciones.altaMiembro({}, formulario(campos));
    expect(r.mensaje).toBe('Ese correo ya pertenece a otra persona del consultorio');
    expect(r.passwordTemporal).toBeUndefined();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('editarMiembro', () => {
  test('envía rol y admin al miembro', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({}));
    const r = await acciones.editarMiembro({}, formulario({ usuarioId: USUARIO, rol: 'medico', admin: 'on' }));
    expect(r).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([
      `/api/identidad/miembros/${USUARIO}`,
      { metodo: 'PATCH', cuerpo: { rol: 'medico', admin: true } },
    ]);
  });

  test('409: el consultorio necesita al menos un administrador', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(409, error('CONFLICTO')));
    expect(await acciones.editarMiembro({}, formulario({ usuarioId: USUARIO, rol: 'medico' }))).toEqual({ mensaje: ULTIMO_ADMIN });
  });

  test('id o rol inválidos no llaman a la API', async () => {
    const r = await acciones.editarMiembro({}, formulario({ usuarioId: 'no-uuid', rol: 'dios' }));
    expect(r.errores).toBeDefined();
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });
});

describe('reiniciarPassword', () => {
  test('envía la contraseña temporal y la devuelve una vez', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito(undefined));
    const r = await acciones.reiniciarPassword({}, formulario({ usuarioId: USUARIO, passwordTemporal: 'Otra-Temporal-1' }));
    expect(r).toEqual({ ok: true, passwordTemporal: 'Otra-Temporal-1' });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([
      `/api/identidad/miembros/${USUARIO}/password-temporal`,
      { metodo: 'POST', cuerpo: { passwordTemporal: 'Otra-Temporal-1' } },
    ]);
  });

  test('contraseña corta: error de campo', async () => {
    const r = await acciones.reiniciarPassword({}, formulario({ usuarioId: USUARIO, passwordTemporal: 'corta' }));
    expect(r.errores?.passwordTemporal).toBe('La contraseña debe tener al menos 10 caracteres');
  });

  test('409 por cuenta compartida y 404 tienen su texto', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(409, error('CONFLICTO')));
    const c = await acciones.reiniciarPassword({}, formulario({ usuarioId: USUARIO, passwordTemporal: 'Otra-Temporal-1' }));
    expect(c.mensaje).toMatch(/otro consultorio/);
    m.llamarGateway.mockResolvedValueOnce(fallo(404, error('NO_ENCONTRADO')));
    const n = await acciones.reiniciarPassword({}, formulario({ usuarioId: USUARIO, passwordTemporal: 'Otra-Temporal-1' }));
    expect(n.mensaje).toBe('El registro ya no existe');
  });
});

describe('quitarMiembro', () => {
  test('borra al miembro y revalida', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito(undefined));
    expect(await acciones.quitarMiembro({}, formulario({ usuarioId: USUARIO }))).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([`/api/identidad/miembros/${USUARIO}`, { metodo: 'DELETE' }]);
    expect(m.revalidatePath).toHaveBeenCalledWith('/equipo');
  });

  test('quitar al último admin muestra "El consultorio necesita al menos un administrador"', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(409, error('CONFLICTO')));
    expect(await acciones.quitarMiembro({}, formulario({ usuarioId: USUARIO }))).toEqual({ mensaje: ULTIMO_ADMIN });
  });

  test('sesión vencida desvía a /login; sin permiso, a /sin-acceso; límite de intentos avisa', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(401, error('NO_AUTENTICADO')));
    await expect(acciones.quitarMiembro({}, formulario({ usuarioId: USUARIO }))).rejects.toThrow('REDIRECT:/login');
    m.llamarGateway.mockResolvedValueOnce(fallo(403, error('PROHIBIDO')));
    await expect(acciones.quitarMiembro({}, formulario({ usuarioId: USUARIO }))).rejects.toThrow('REDIRECT:/sin-acceso');
    m.llamarGateway.mockResolvedValueOnce(fallo(429, error('INTERNO')));
    expect((await acciones.quitarMiembro({}, formulario({ usuarioId: USUARIO }))).mensaje).toMatch(/Demasiados intentos/);
    m.llamarGateway.mockResolvedValueOnce(fallo(500, error('INTERNO')));
    expect((await acciones.quitarMiembro({}, formulario({ usuarioId: USUARIO }))).mensaje).toBe('Ocurrió un error. Intenta de nuevo.');
  });

  test('id inválido no llama a la API', async () => {
    expect((await acciones.quitarMiembro({}, formulario({ usuarioId: 'x' }))).errores).toBeDefined();
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });
});
