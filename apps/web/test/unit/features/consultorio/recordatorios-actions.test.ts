// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
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

const { guardarConfigRecordatorios } = await import('@/features/consultorio/actions');

const formulario = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
const valido = { modo: 'sin_revision', horaEnvio: '09:30', correoAsunto: 'Asunto', correoCuerpo: 'Cuerpo {paciente}', whatsapp: 'Hola {paciente}' };
const configApi = {
  modo: 'sin_revision',
  horaEnvio: '09:30',
  plantillas: { correoAsunto: 'Asunto', correoCuerpo: 'Cuerpo {paciente}', whatsapp: 'Hola {paciente}' },
};

beforeEach(() => vi.clearAllMocks());

describe('guardarConfigRecordatorios', () => {
  test('envía modo, hora y plantillas al servicio y refresca la página', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito(configApi));
    expect(await guardarConfigRecordatorios({}, formulario(valido))).toEqual({ ok: true });
    expect(m.llamarGateway).toHaveBeenCalledWith(
      '/api/notificaciones/config',
      expect.objectContaining({
        metodo: 'PUT',
        auth: 'token',
        cuerpo: { modo: 'sin_revision', horaEnvio: '09:30', plantillas: { correoAsunto: 'Asunto', correoCuerpo: 'Cuerpo {paciente}', whatsapp: 'Hola {paciente}' } },
      }),
    );
    expect(m.revalidatePath).toHaveBeenCalledWith('/consultorio');
  });

  test('una plantilla demasiado larga no llega al servicio y señala el campo', async () => {
    const r = await guardarConfigRecordatorios({}, formulario({ ...valido, correoCuerpo: 'x'.repeat(1001) }));
    expect(r.errores).toEqual({ correoCuerpo: 'Máximo 1000 caracteres' });
    expect(r.valores?.correoCuerpo).toHaveLength(1001);
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('modo u hora inválidos no llegan al servicio', async () => {
    expect((await guardarConfigRecordatorios({}, formulario({ ...valido, modo: 'otro' }))).errores).toEqual({ modo: 'Elige un modo' });
    expect((await guardarConfigRecordatorios({}, formulario({ ...valido, horaEnvio: '25:00' }))).errores).toEqual({ horaEnvio: 'Escribe una hora válida (HH:MM)' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('un 400 del servicio con el campo se muestra junto al campo', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(400, { code: 'VALIDACION', message: 'Máximo 700 caracteres', details: [{ campo: 'whatsapp' }] } as never));
    const r = await guardarConfigRecordatorios({}, formulario(valido));
    expect(r.errores).toEqual({ whatsapp: 'Máximo 700 caracteres' });
  });

  test('sin permiso desvía; otro error da el aviso general conservando lo escrito', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(403, { code: 'PROHIBIDO', message: 'x' } as never));
    await expect(guardarConfigRecordatorios({}, formulario(valido))).rejects.toThrow('REDIRECT:/sin-acceso');
    m.llamarGateway.mockResolvedValueOnce(fallo(500, { code: 'INTERNO', message: 'x' } as never));
    const r = await guardarConfigRecordatorios({}, formulario(valido));
    expect(r.mensaje).toBe('Ocurrió un error. Intenta de nuevo.');
    expect(r.valores?.whatsapp).toBe('Hola {paciente}');
  });
});
