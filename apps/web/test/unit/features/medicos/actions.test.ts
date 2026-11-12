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
vi.mock('@/lib/sesion/contexto', () => ({
  obtenerContexto: async () => ({
    claims: { sub: 'u1', tid: 't1', rol: 'medico', admin: true, mfa: true },
    consultorio: { id: 't1', nombre: 'Centro', slug: 'centro', zonaHoraria: 'America/Mexico_City' },
  }),
}));

const acciones = await import('@/features/medicos/actions');
const api = await import('@/features/medicos/api');

const MEDICO = '0190a0a0-0000-7000-8000-00000000000a';
const TIPO = '0190a0a0-0000-7000-8000-00000000000b';
const BLOQUEO = '0190a0a0-0000-7000-8000-00000000000c';
const formulario = (campos: Record<string, string>, filas: [string, string, string][] = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  for (const [d, i, f] of filas) {
    fd.append('diaSemana', d);
    fd.append('horaInicio', i);
    fd.append('horaFin', f);
  }
  return fd;
};
const error = (code: string, message = 'x') => ({ code, message }) as never;

beforeEach(() => {
  m.llamarGateway.mockReset();
  m.revalidatePath.mockReset();
});

describe('lecturas', () => {
  test('horario, bloqueos desde un instante y tipos (todos) con los contratos', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ bloques: [{ diaSemana: 1, horaInicio: '09:00', horaFin: '13:00' }] }));
    expect(await api.leerHorario(MEDICO)).toEqual({ ok: true, datos: [{ diaSemana: 1, horaInicio: '09:00', horaFin: '13:00' }] });
    expect(m.llamarGateway.mock.calls[0]?.[0]).toBe(`/api/agenda/medicos/${MEDICO}/horario`);

    m.llamarGateway.mockResolvedValueOnce(exito({ bloqueos: [] }));
    expect(await api.listarBloqueosDesde(MEDICO, '2026-11-12T00:00:00.000Z')).toEqual({ ok: true, datos: [] });
    expect(m.llamarGateway.mock.calls[1]?.[0]).toBe(`/api/agenda/medicos/${MEDICO}/bloqueos?desde=2026-11-12T00%3A00%3A00.000Z`);
  });

  test('propagan el error', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(404, error('NO_ENCONTRADO')));
    expect((await api.leerHorario(MEDICO)).ok).toBe(false);
    m.llamarGateway.mockResolvedValueOnce(fallo(404, error('NO_ENCONTRADO')));
    expect((await api.listarBloqueosDesde(MEDICO, 'x')).ok).toBe(false);
  });
});

describe('guardarSemana', () => {
  const filas: [string, string, string][] = [
    ['1', '09:00', '13:00'],
    ['1', '', ''],
    ['2', '10:00', '12:00'],
  ];

  test('PUT del horario completo y revalida la ficha del médico', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ bloques: [] }));
    const r = await acciones.guardarSemana({}, formulario({ medicoId: MEDICO }, filas));
    expect(r).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([
      `/api/agenda/medicos/${MEDICO}/horario`,
      {
        metodo: 'PUT',
        auth: 'token',
        cuerpo: {
          bloques: [
            { diaSemana: 1, horaInicio: '09:00', horaFin: '13:00' },
            { diaSemana: 2, horaInicio: '10:00', horaFin: '12:00' },
          ],
        },
      },
    ]);
    expect(m.revalidatePath).toHaveBeenCalledWith(`/medicos/${MEDICO}`);
  });

  test('encimados: avisa antes de llamar a la API', async () => {
    const r = await acciones.guardarSemana({}, formulario({ medicoId: MEDICO }, [['1', '09:00', '13:00'], ['1', '12:00', '14:00']]));
    expect(r.mensaje).toBe('Los bloques del lunes se enciman: 09:00–13:00 y 12:00–14:00');
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('médico inválido', async () => {
    expect((await acciones.guardarSemana({}, formulario({ medicoId: 'x' }, filas))).mensaje).toBe('Revisa los datos del formulario');
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('el 400 de la API muestra su mensaje; 403 desvía a /sin-acceso', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(400, error('VALIDACION', 'Los bloques del horario se enciman')));
    expect((await acciones.guardarSemana({}, formulario({ medicoId: MEDICO }, filas))).mensaje).toBe('Los bloques del horario se enciman');
    m.llamarGateway.mockResolvedValueOnce(fallo(403, error('PROHIBIDO')));
    await expect(acciones.guardarSemana({}, formulario({ medicoId: MEDICO }, filas))).rejects.toThrow('REDIRECT:/sin-acceso');
  });
});

describe('tipos de cita', () => {
  test('crearTipoCita envía nombre y duración numérica', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({}));
    const r = await acciones.crearTipoCita({}, formulario({ medicoId: MEDICO, nombre: ' Primera vez ', duracionMin: '45' }));
    expect(r).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([
      `/api/agenda/medicos/${MEDICO}/tipos-cita`,
      { metodo: 'POST', cuerpo: { nombre: 'Primera vez', duracionMin: 45 } },
    ]);
    expect(m.revalidatePath).toHaveBeenCalledWith(`/medicos/${MEDICO}`);
  });

  test('crearTipoCita con datos inválidos: errores por campo y valores conservados', async () => {
    const r = await acciones.crearTipoCita({}, formulario({ medicoId: MEDICO, nombre: '', duracionMin: '2' }));
    expect(r.errores).toEqual({ nombre: 'El nombre es obligatorio', duracionMin: 'La duración debe ser de 5 a 480 minutos' });
    expect(r.valores).toEqual({ nombre: '', duracionMin: '2' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('editarTipoCita envía nombre, duración y activo', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({}));
    const r = await acciones.editarTipoCita({}, formulario({ medicoId: MEDICO, tipoId: TIPO, nombre: 'Control', duracionMin: '20' }));
    expect(r).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([
      `/api/agenda/medicos/${MEDICO}/tipos-cita/${TIPO}`,
      { metodo: 'PATCH', cuerpo: { nombre: 'Control', duracionMin: 20, activo: false } },
    ]);
    m.llamarGateway.mockResolvedValueOnce(exito({}));
    await acciones.editarTipoCita({}, formulario({ medicoId: MEDICO, tipoId: TIPO, nombre: 'Control', duracionMin: '20', activo: 'on' }));
    expect(m.llamarGateway.mock.calls[1]?.[1]).toMatchObject({ cuerpo: { activo: true } });
  });

  test('editarTipoCita: ids o datos inválidos y error de la API', async () => {
    expect((await acciones.editarTipoCita({}, formulario({ medicoId: MEDICO, tipoId: 'x', nombre: 'a', duracionMin: '20' }))).mensaje).toBe('Revisa los datos del formulario');
    m.llamarGateway.mockResolvedValueOnce(fallo(404, error('NO_ENCONTRADO')));
    expect((await acciones.editarTipoCita({}, formulario({ medicoId: MEDICO, tipoId: TIPO, nombre: 'a', duracionMin: '20' }))).mensaje).toBe('El registro ya no existe');
  });
});

describe('bloqueos', () => {
  const campos = { medicoId: MEDICO, inicio: '2026-11-12T10:00', fin: '2026-11-12T12:00', motivo: 'Congreso' };

  test('crearBloqueo convierte la hora del consultorio a ISO con desfase', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({}));
    expect(await acciones.crearBloqueo({}, formulario(campos))).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([
      `/api/agenda/medicos/${MEDICO}/bloqueos`,
      { metodo: 'POST', cuerpo: { inicio: '2026-11-12T10:00:00.000-06:00', fin: '2026-11-12T12:00:00.000-06:00', motivo: 'Congreso' } },
    ]);
    expect(m.revalidatePath).toHaveBeenCalledWith(`/medicos/${MEDICO}`);
  });

  test('sin motivo no lo envía', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({}));
    await acciones.crearBloqueo({}, formulario({ ...campos, motivo: '' }));
    expect((m.llamarGateway.mock.calls[0]?.[1] as { cuerpo: object }).cuerpo).not.toHaveProperty('motivo');
  });

  test('fin anterior al inicio o fechas vacías: errores por campo', async () => {
    const r = await acciones.crearBloqueo({}, formulario({ ...campos, fin: '2026-11-12T09:00' }));
    expect(r.errores).toEqual({ fin: 'El inicio debe ser anterior al fin' });
    expect(r.valores).toMatchObject({ inicio: campos.inicio, fin: '2026-11-12T09:00', motivo: 'Congreso' });
    const v = await acciones.crearBloqueo({}, formulario({ ...campos, inicio: '' }));
    expect(v.errores?.inicio).toBe('Elige el inicio');
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('fecha ilegible tras pasar el esquema', async () => {
    const r = await acciones.crearBloqueo({}, formulario({ ...campos, inicio: '2026-13-45T10:00', fin: '2026-13-46T10:00' }));
    expect(r.errores?.inicio).toBe('Elige una fecha y hora válidas');
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('eliminarBloqueo borra y revalida', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito(undefined));
    expect(await acciones.eliminarBloqueo({}, formulario({ medicoId: MEDICO, bloqueoId: BLOQUEO }))).toEqual({ ok: true });
    expect(m.llamarGateway.mock.calls[0]).toMatchObject([`/api/agenda/medicos/${MEDICO}/bloqueos/${BLOQUEO}`, { metodo: 'DELETE' }]);
    expect(m.revalidatePath).toHaveBeenCalledWith(`/medicos/${MEDICO}`);
  });

  test('eliminarBloqueo: ids inválidos y errores de la API', async () => {
    expect((await acciones.eliminarBloqueo({}, formulario({ medicoId: MEDICO, bloqueoId: 'x' }))).mensaje).toBe('Revisa los datos del formulario');
    m.llamarGateway.mockResolvedValueOnce(fallo(500, error('INTERNO')));
    expect((await acciones.eliminarBloqueo({}, formulario({ medicoId: MEDICO, bloqueoId: BLOQUEO }))).mensaje).toBe('Ocurrió un error. Intenta de nuevo.');
  });
});
