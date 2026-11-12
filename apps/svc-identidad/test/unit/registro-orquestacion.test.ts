import { TenantCreado, UsuarioVinculado } from '@consultorio/contracts';
import { AppError } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { describe, expect, test, vi } from 'vitest';
import { construirEventos, registrarConsultorio, registroSchema, type RegistroDeps } from '../../src/routes/registro.js';

const input = registroSchema.parse({
  nombreConsultorio: 'Consultorio Uno',
  slug: 'uno',
  zonaHoraria: 'America/Mexico_City',
  esMedico: true,
  admin: { nombre: 'Ana', email: 'ana@ejemplo.mx', password: 'una-clave-larga' },
});
const USUARIO = uuidv7();
const TRACE = '0af7651916cd43dd8448eb211c80319c';

function fakes(over: Partial<RegistroDeps> = {}) {
  return {
    existeSlug: vi.fn(async () => false),
    existeEmail: vi.fn(async () => false),
    crearUsuario: vi.fn(async () => ({ id: USUARIO })),
    crearTenant: vi.fn(async () => {}),
    borrarUsuario: vi.fn(async () => {}),
    log: { error: vi.fn() },
    ...over,
  } as RegistroDeps & { log: { error: ReturnType<typeof vi.fn> } };
}

const unique = () => Object.assign(new Error('duplicate key'), { code: '23505' });
const falla = (e: unknown) => vi.fn(async () => {
  throw e;
});

describe('construirEventos', () => {
  test('genera tenant.creado y usuario.vinculado v2 (rol de trabajo + admin) válidos contra el contrato', () => {
    const tenantId = uuidv7();
    const [a, b] = construirEventos({ tenantId, usuarioId: USUARIO, input, traceId: TRACE });
    expect(TenantCreado.parse(a)).toMatchObject({
      tenant_id: tenantId,
      actor_id: USUARIO,
      trace_id: TRACE,
      data: { tenantId, nombre: 'Consultorio Uno', slug: 'uno', zonaHoraria: 'America/Mexico_City', adminUsuarioId: USUARIO },
    });
    expect(UsuarioVinculado.parse(b)).toMatchObject({ tenant_id: tenantId, version: 2, data: { usuarioId: USUARIO, nombre: 'Ana', rol: 'medico', admin: true } });
  });

  test('esMedico=false: el fundador es recepción con permiso admin', () => {
    const [, b] = construirEventos({ tenantId: uuidv7(), usuarioId: USUARIO, input: { ...input, esMedico: false }, traceId: TRACE });
    expect(UsuarioVinculado.parse(b).data).toEqual({ usuarioId: USUARIO, nombre: 'Ana', rol: 'recepcion', admin: true });
  });
});

describe('registrarConsultorio', () => {
  test('camino feliz: crea usuario, luego tenant con eventos; devuelve ids', async () => {
    const d = fakes();
    const r = await registrarConsultorio(d, input, TRACE);
    expect(r.usuarioId).toBe(USUARIO);
    expect(r.tenantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(d.crearUsuario).toHaveBeenCalledWith({ nombre: 'Ana', email: 'ana@ejemplo.mx', password: 'una-clave-larga' });
    const plan = vi.mocked(d.crearTenant).mock.calls[0]?.[0];
    expect(plan?.tenantId).toBe(r.tenantId);
    expect(plan?.eventos.map((e) => e.type)).toEqual(['tenant.creado', 'usuario.vinculado']);
    expect(d.borrarUsuario).not.toHaveBeenCalled();
  });

  test('slug existente → 409 CONFLICTO sin crear usuario', async () => {
    const d = fakes({ existeSlug: vi.fn(async () => true) });
    const err = await registrarConsultorio(d, input, TRACE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'CONFLICTO', status: 409 });
    expect(d.crearUsuario).not.toHaveBeenCalled();
  });

  test('email existente → 409 CONFLICTO sin crear usuario', async () => {
    const d = fakes({ existeEmail: vi.fn(async () => true) });
    await expect(registrarConsultorio(d, input, TRACE)).rejects.toMatchObject({ code: 'CONFLICTO', status: 409 });
    expect(d.crearUsuario).not.toHaveBeenCalled();
  });

  test('carrera: la transacción choca con la restricción única → compensa y responde 409', async () => {
    const d = fakes({ crearTenant: falla(unique()) });
    await expect(registrarConsultorio(d, input, TRACE)).rejects.toMatchObject({ code: 'CONFLICTO', status: 409 });
    expect(d.borrarUsuario).toHaveBeenCalledWith(USUARIO);
  });

  test('fallo no esperado de la transacción → borra el usuario y relanza el error original', async () => {
    const boom = new Error('se cayó la base');
    const d = fakes({ crearTenant: falla(boom) });
    await expect(registrarConsultorio(d, input, TRACE)).rejects.toBe(boom);
    expect(d.borrarUsuario).toHaveBeenCalledWith(USUARIO);
    expect(d.log.error).not.toHaveBeenCalled();
  });

  test('si la compensación también falla: registra en error con el id del usuario y devuelve el error original', async () => {
    const boom = new Error('se cayó la base');
    const d = fakes({ crearTenant: falla(boom), borrarUsuario: falla(new Error('no se pudo borrar')) });
    await expect(registrarConsultorio(d, input, TRACE)).rejects.toBe(boom);
    expect(d.log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(d.log.error).mock.calls[0])).toContain(USUARIO);
  });

  test('compensación fallida en un choque de unicidad: igual 409 y se registra', async () => {
    const d = fakes({ crearTenant: falla(unique()), borrarUsuario: falla(new Error('no se pudo borrar')) });
    await expect(registrarConsultorio(d, input, TRACE)).rejects.toMatchObject({ code: 'CONFLICTO' });
    expect(d.log.error).toHaveBeenCalledTimes(1);
  });

  test('nunca registra la contraseña', async () => {
    const d = fakes({ crearTenant: falla(new Error('x')), borrarUsuario: falla(new Error('y')) });
    await registrarConsultorio(d, input, TRACE).catch(() => {});
    expect(JSON.stringify(vi.mocked(d.log.error).mock.calls)).not.toContain('una-clave-larga');
  });
});
