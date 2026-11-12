// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ llamarGateway: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '9.9.9.9' }) }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));
vi.mock('@/lib/api/gateway', () => ({
  llamarGateway: m.llamarGateway,
  ipDelCliente: (h: Headers) => h.get('x-forwarded-for') ?? undefined,
}));

const acciones = await import('@/features/agenda/actions');

const MEDICO = '0190a0a0-0000-7000-8000-00000000000a';
const TIPO = '0190a0a0-0000-7000-8000-00000000000b';
const CITA = '0190a0a0-0000-7000-8000-0000000000c1';
const INICIO = '2026-11-12T16:00:00.000Z';
const citaApi = {
  id: CITA,
  medicoId: MEDICO,
  tipoCitaId: TIPO,
  inicio: INICIO,
  fin: '2026-11-12T16:30:00.000Z',
  estado: 'agendada',
  contacto: { nombre: 'Ana Pérez', telefono: '5551234567' },
  fueraDeHorario: false,
  version: 2,
};
const error = (code: string, message = 'x') => ({ code, message }) as never;
const entrada = { medicoId: MEDICO, tipoCitaId: TIPO, inicio: INICIO, nombre: 'Ana Pérez', telefono: '5551234567', email: '', notas: '' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('crearCita', () => {
  test('envía el cuerpo del contrato (sin opcionales vacíos) y revalida /agenda', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito(citaApi));
    const r = await acciones.crearCita(entrada);
    expect(r).toEqual({ ok: true });
    const [ruta, o] = m.llamarGateway.mock.calls[0] ?? [];
    expect(ruta).toBe('/api/agenda/citas');
    expect(o).toMatchObject({
      metodo: 'POST',
      auth: 'token',
      cuerpo: { medicoId: MEDICO, tipoCitaId: TIPO, inicio: INICIO, contacto: { nombre: 'Ana Pérez', telefono: '5551234567' }, fueraDeHorario: false },
    });
    const cuerpo = (o as { cuerpo: { notas?: string; contacto: { email?: string } } }).cuerpo;
    expect(cuerpo.notas).toBeUndefined();
    expect(cuerpo.contacto.email).toBeUndefined();
    expect(m.revalidatePath).toHaveBeenCalledWith('/agenda');
  });

  test('con correo y notas los incluye', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito(citaApi));
    await acciones.crearCita({ ...entrada, email: 'ana@ejemplo.mx', notas: 'Primera vez' });
    expect(m.llamarGateway.mock.calls[0]?.[1]).toMatchObject({
      cuerpo: { notas: 'Primera vez', contacto: { email: 'ana@ejemplo.mx' } },
    });
  });

  test('datos inválidos: errores por campo en español y no llama al gateway', async () => {
    const r = await acciones.crearCita({ ...entrada, nombre: '', telefono: 'abc', email: 'no-es-correo' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
    expect(r).toMatchObject({ errores: { nombre: expect.any(String), telefono: expect.any(String), email: expect.any(String) } });
  });

  test('FUERA_DE_HORARIO devuelve el motivo para ofrecer "Agendar de todos modos"', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(422, error('FUERA_DE_HORARIO')));
    expect(await acciones.crearCita(entrada)).toEqual({ ok: false, motivo: 'FUERA_DE_HORARIO' });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  test('reenvío con fueraDeHorario: true', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito(citaApi));
    await acciones.crearCita({ ...entrada, fueraDeHorario: true });
    expect(m.llamarGateway.mock.calls[0]?.[1]).toMatchObject({ cuerpo: { fueraDeHorario: true } });
  });

  test('HORARIO_OCUPADO: mensaje de la spec y pide recargar huecos', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(409, error('HORARIO_OCUPADO')));
    expect(await acciones.crearCita(entrada)).toEqual({ mensaje: 'Ese horario ya se ocupó, elige otro', recargar: true });
  });

  test('HORARIO_BLOQUEADO', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(409, error('HORARIO_BLOQUEADO')));
    expect(await acciones.crearCita(entrada)).toEqual({ mensaje: 'El médico tiene ese horario bloqueado' });
  });

  test('PROHIBIDO redirige a /sin-acceso y NO_AUTENTICADO a /login', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(403, error('PROHIBIDO')));
    await expect(acciones.crearCita(entrada)).rejects.toThrow('REDIRECT:/sin-acceso');
    m.llamarGateway.mockResolvedValueOnce(fallo(401, error('NO_AUTENTICADO')));
    await expect(acciones.crearCita(entrada)).rejects.toThrow('REDIRECT:/login');
  });

  test('error 5xx o de red: aviso genérico, sin el mensaje interno', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(503, { code: 'INTERNO', message: 'ECONNREFUSED 10.0.0.5' }));
    expect(await acciones.crearCita(entrada)).toEqual({ mensaje: 'Ocurrió un error. Intenta de nuevo.' });
  });
});

describe('reprogramarCita', () => {
  const datos = { citaId: CITA, version: 1, inicio: INICIO };

  test('PATCH con versión e inicio; revalida', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito(citaApi));
    expect(await acciones.reprogramarCita({ ...datos, tipoCitaId: TIPO })).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toEqual([
      `/api/agenda/citas/${CITA}`,
      expect.objectContaining({ metodo: 'PATCH', cuerpo: { version: 1, inicio: INICIO, tipoCitaId: TIPO, fueraDeHorario: false } }),
    ]);
    expect(m.revalidatePath).toHaveBeenCalledWith('/agenda');
  });

  test('Review Focus 2: CONFLICTO_VERSION devuelve "Alguien modificó esta cita" y pide recargar', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(409, error('CONFLICTO_VERSION')));
    expect(await acciones.reprogramarCita(datos)).toEqual({ mensaje: 'Alguien modificó esta cita', recargar: true });
  });

  test('FUERA_DE_HORARIO devuelve motivo', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(422, error('FUERA_DE_HORARIO')));
    expect(await acciones.reprogramarCita(datos)).toEqual({ ok: false, motivo: 'FUERA_DE_HORARIO' });
  });

  test('rechaza ids o instantes inválidos sin llamar al gateway', async () => {
    const r = await acciones.reprogramarCita({ citaId: 'no-uuid', version: 0, inicio: 'ayer' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
    expect(r).toEqual({ mensaje: 'Revisa los datos del formulario' });
  });
});

describe('cambiarEstadoCita', () => {
  test('POST /estado con versión', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ ...citaApi, estado: 'confirmada' }));
    expect(await acciones.cambiarEstadoCita({ citaId: CITA, version: 2, estado: 'confirmada' })).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toEqual([
      `/api/agenda/citas/${CITA}/estado`,
      expect.objectContaining({ metodo: 'POST', cuerpo: { version: 2, estado: 'confirmada' } }),
    ]);
    expect(m.revalidatePath).toHaveBeenCalledWith('/agenda');
  });

  test('CONFLICTO (transición inválida) muestra su mensaje', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(409, error('CONFLICTO')));
    expect(await acciones.cambiarEstadoCita({ citaId: CITA, version: 2, estado: 'atendida' })).toEqual({
      mensaje: 'Ese cambio de estado ya no es posible para esta cita',
      recargar: true,
    });
  });
});

describe('lecturas para el cliente', () => {
  test('cargarCitas devuelve las citas validadas', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ citas: [citaApi] }));
    const r = await acciones.cargarCitas('2026-11-12T06:00:00.000Z', '2026-11-13T06:00:00.000Z', MEDICO);
    expect(r).toEqual({ ok: true, citas: [citaApi] });
    const ruta = m.llamarGateway.mock.calls[0]?.[0] as string;
    expect(ruta.startsWith('/api/agenda/citas?')).toBe(true);
    const q = new URL(ruta, 'http://x').searchParams;
    expect(q.get('desde')).toBe('2026-11-12T06:00:00.000Z');
    expect(q.get('medicoId')).toBe(MEDICO);
  });

  test('cargarCitas sin médico no manda medicoId; error → mensaje genérico', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(502, error('INTERNO')));
    const r = await acciones.cargarCitas('2026-11-12T06:00:00.000Z', '2026-11-13T06:00:00.000Z');
    expect(r).toEqual({ ok: false, mensaje: 'Ocurrió un error. Intenta de nuevo.' });
    expect(m.llamarGateway.mock.calls[0]?.[0]).not.toContain('medicoId');
  });

  test('cargarHuecos', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ fecha: '2026-11-12', tipoCitaId: TIPO, huecos: [INICIO] }));
    expect(await acciones.cargarHuecos(MEDICO, '2026-11-12', TIPO)).toEqual({ ok: true, huecos: [INICIO] });
    expect(m.llamarGateway.mock.calls[0]?.[0]).toBe(`/api/agenda/medicos/${MEDICO}/disponibilidad?fecha=2026-11-12&tipoCitaId=${TIPO}`);
  });

  test('cargarHuecos con 404: el tipo de cita o el médico ya no está disponible (no "la cita ya no existe")', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(404, error('NO_ENCONTRADO')));
    expect(await acciones.cargarHuecos(MEDICO, '2026-11-12', TIPO)).toEqual({ ok: false, mensaje: 'Ese tipo de cita o médico ya no está disponible' });
  });

  test('cargarHuecos con parámetros inválidos no llama', async () => {
    const r = await acciones.cargarHuecos('x', 'mañana', 'y');
    expect(r.ok).toBe(false);
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });
});
