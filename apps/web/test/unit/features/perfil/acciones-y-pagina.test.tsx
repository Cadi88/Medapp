// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ llamarGateway: vi.fn(), revalidatePath: vi.fn(), obtenerContexto: vi.fn(), listarMiembros: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '9.9.9.9' }) }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/api/gateway', () => ({ llamarGateway: m.llamarGateway, ipDelCliente: (h: Headers) => h.get('x-forwarded-for') ?? undefined }));
vi.mock('@/lib/sesion/contexto', () => ({ obtenerContexto: m.obtenerContexto }));
vi.mock('@/features/equipo/api', () => ({ listarMiembros: m.listarMiembros }));
vi.mock('@/features/sesion/actions', () => ({}));

const { guardarPerfilMedico } = await import('@/features/perfil/actions');
const { default: PerfilPage } = await import('@/app/(app)/perfil/page');

const YO = '0190a0a0-0000-7000-8000-00000000000a';
const contexto = (rol: 'medico' | 'recepcion') => ({
  claims: { sub: YO, tid: 't1', rol, admin: false, mfa: true },
  consultorio: { id: 't1', nombre: 'Centro', slug: 'centro', zonaHoraria: 'America/Mexico_City' },
});
const formulario = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
const campos = { cedulaProfesional: '1234567', especialidad: ' Pediatría ', cedulaEspecialidad: '', institucion: '' };

beforeEach(() => {
  vi.resetAllMocks();
  m.obtenerContexto.mockResolvedValue(contexto('medico'));
});

describe('guardarPerfilMedico', () => {
  test('PUT al perfil de la propia persona (del token), sin enviar los opcionales vacíos', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({}));
    expect(await guardarPerfilMedico({}, formulario(campos))).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([
      `/api/identidad/medicos/${YO}/perfil`,
      { metodo: 'PUT', auth: 'token', cuerpo: { cedulaProfesional: '1234567', especialidad: 'Pediatría' } },
    ]);
    const cuerpo = (m.llamarGateway.mock.calls[0]?.[1] as { cuerpo: object }).cuerpo;
    expect(cuerpo).not.toHaveProperty('institucion');
    expect(cuerpo).not.toHaveProperty('cedulaEspecialidad');
    expect(m.revalidatePath).toHaveBeenCalledWith('/perfil');
  });

  test('la cédula debe tener 7 u 8 dígitos; conserva lo escrito', async () => {
    const r = await guardarPerfilMedico({}, formulario({ ...campos, cedulaProfesional: '12ab' }));
    expect(r.errores).toEqual({ cedulaProfesional: 'La cédula profesional debe tener 7 u 8 dígitos' });
    expect(r.valores).toEqual({ ...campos, cedulaProfesional: '12ab' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('textos demasiado largos', async () => {
    const r = await guardarPerfilMedico({}, formulario({ ...campos, especialidad: 'x'.repeat(201) }));
    expect(r.errores?.especialidad).toBe('Máximo 200 caracteres');
  });

  test('errores de la API', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(404, { code: 'NO_ENCONTRADO', message: 'x' }));
    expect((await guardarPerfilMedico({}, formulario(campos))).mensaje).toBe('El registro ya no existe');
    m.llamarGateway.mockResolvedValueOnce(fallo(403, { code: 'PROHIBIDO', message: 'x' }));
    await expect(guardarPerfilMedico({}, formulario(campos))).rejects.toThrow('REDIRECT:/sin-acceso');
  });
});

/** Nombres de componentes y textos de un árbol de elementos sin renderizar (la página es un Server Component asíncrono). */
function recorrer(n: unknown, salida: string[] = []): string[] {
  if (typeof n === 'string') salida.push(n);
  else if (Array.isArray(n)) for (const h of n) recorrer(h, salida);
  else if (n && typeof n === 'object' && 'props' in n) {
    const { type, props } = n as { type: unknown; props: { children?: unknown } };
    if (typeof type === 'function') salida.push(type.name);
    recorrer(props.children, salida);
  }
  return salida;
}

describe('página de perfil', () => {
  const yo = { usuarioId: YO, nombre: 'Dra. Ruiz', email: 'ruiz@ejemplo.mx', rol: 'medico', admin: false, mfaActivo: true, debeCambiarPassword: false, perfilMedico: null };

  test('un médico ve su perfil profesional', async () => {
    m.listarMiembros.mockResolvedValue(exito([yo]));
    const arbol = recorrer(await PerfilPage());
    expect(arbol).toContain('FormularioPerfilMedico');
    expect(arbol).toContain('FormularioPasswordPerfil');
  });

  test('recepción solo ve cuenta y contraseña', async () => {
    m.obtenerContexto.mockResolvedValue(contexto('recepcion'));
    m.listarMiembros.mockResolvedValue(exito([{ ...yo, rol: 'recepcion' }]));
    const arbol = recorrer(await PerfilPage());
    expect(arbol).not.toContain('FormularioPerfilMedico');
    expect(arbol).toContain('ruiz@ejemplo.mx');
  });

  test('si no se encuentra a la persona en la lista, igual se muestra la contraseña', async () => {
    m.listarMiembros.mockResolvedValue(exito([]));
    await expect(PerfilPage()).resolves.toBeTruthy();
  });
});
