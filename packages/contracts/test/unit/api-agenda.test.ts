import { describe, expect, test } from 'vitest';
import {
  CitaCancelada,
  CitaCreada,
  CitaEstadoCambiado,
  CitaReprogramada,
  type EventDefinition,
  bloqueHorarioSchema,
  cambiarEstadoSchema,
  citaSchema,
  crearCitaSchema,
  reprogramarCitaSchema,
  crearBloqueoSchema,
  crearTipoCitaSchema,
  disponibilidadSchema,
  editarTipoCitaSchema,
  medicoAgendaSchema,
  semanaSchema,
  tipoCitaSchema,
} from '../../src/index.js';

const U = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

describe('tipos de cita', () => {
  test('duración 5..480 y nombre 1..80', () => {
    expect(crearTipoCitaSchema.safeParse({ nombre: 'Consulta', duracionMin: 30 }).success).toBe(true);
    expect(crearTipoCitaSchema.safeParse({ nombre: 'Consulta', duracionMin: 3 }).success).toBe(false);
    expect(crearTipoCitaSchema.safeParse({ nombre: 'Consulta', duracionMin: 481 }).success).toBe(false);
    expect(crearTipoCitaSchema.safeParse({ nombre: '', duracionMin: 30 }).success).toBe(false);
    expect(crearTipoCitaSchema.safeParse({ nombre: 'x'.repeat(81), duracionMin: 30 }).success).toBe(false);
  });
  test('el nombre se recorta: solo espacios no cuenta como nombre', () => {
    expect(crearTipoCitaSchema.safeParse({ nombre: '   ', duracionMin: 30 }).success).toBe(false);
    expect(editarTipoCitaSchema.safeParse({ nombre: ' \t ' }).success).toBe(false);
    expect(crearTipoCitaSchema.parse({ nombre: '  Consulta  ', duracionMin: 30 }).nombre).toBe('Consulta');
  });
  test('editar acepta parciales y rechaza duración inválida', () => {
    expect(editarTipoCitaSchema.safeParse({ activo: false }).success).toBe(true);
    expect(editarTipoCitaSchema.safeParse({ duracionMin: 4 }).success).toBe(false);
  });
  test('tipoCitaSchema y medicoAgendaSchema', () => {
    expect(tipoCitaSchema.safeParse({ id: U, medicoId: U, nombre: 'C', duracionMin: 30, activo: true }).success).toBe(true);
    expect(medicoAgendaSchema.safeParse({ usuarioId: U, nombre: 'Ana' }).success).toBe(true);
  });
});

describe('horario', () => {
  test('bloque: día 0..6 y HH:mm', () => {
    expect(bloqueHorarioSchema.safeParse({ diaSemana: 1, horaInicio: '09:00', horaFin: '14:00' }).success).toBe(true);
    expect(bloqueHorarioSchema.safeParse({ diaSemana: 7, horaInicio: '09:00', horaFin: '14:00' }).success).toBe(false);
    expect(bloqueHorarioSchema.safeParse({ diaSemana: 1, horaInicio: '9:00', horaFin: '14:00' }).success).toBe(false);
  });
  test('semana: máximo 28 bloques', () => {
    const b = { diaSemana: 1, horaInicio: '09:00', horaFin: '14:00' };
    expect(semanaSchema.safeParse({ bloques: Array(28).fill(b) }).success).toBe(true);
    expect(semanaSchema.safeParse({ bloques: Array(29).fill(b) }).success).toBe(false);
  });
});

describe('bloqueos', () => {
  test('inicio < fin y offset obligatorio', () => {
    const ok = { inicio: '2030-01-07T15:00:00Z', fin: '2030-01-07T16:00:00Z' };
    expect(crearBloqueoSchema.safeParse(ok).success).toBe(true);
    expect(crearBloqueoSchema.safeParse({ ...ok, fin: ok.inicio }).success).toBe(false);
    expect(crearBloqueoSchema.safeParse({ ...ok, inicio: '2030-01-07T15:00:00' }).success).toBe(false);
    expect(crearBloqueoSchema.safeParse({ ...ok, motivo: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('disponibilidad', () => {
  test('forma de la respuesta', () => {
    expect(disponibilidadSchema.safeParse({ fecha: '2030-01-07', tipoCitaId: U, huecos: ['2030-01-07T15:00:00.000Z'] }).success).toBe(true);
  });
});

describe('citas', () => {
  const base = { medicoId: U, tipoCitaId: U, inicio: '2030-01-07T17:00:00Z', contacto: { nombre: 'Paciente', telefono: '+52 55 1234 5678' } };

  test('crearCitaSchema valida contacto y asigna fueraDeHorario=false por omisión', () => {
    const ok = crearCitaSchema.parse(base);
    expect(ok.fueraDeHorario).toBe(false);
    expect(crearCitaSchema.safeParse({ ...base, contacto: { nombre: '', telefono: '+52 55 1234 5678' } }).success).toBe(false);
    expect(crearCitaSchema.safeParse({ ...base, contacto: { nombre: 'P', telefono: 'abc' } }).success).toBe(false);
    expect(crearCitaSchema.safeParse({ ...base, contacto: { nombre: 'P', telefono: '5555555555', email: 'no-es-correo' } }).success).toBe(false);
    expect(crearCitaSchema.safeParse({ ...base, notas: 'x'.repeat(1001) }).success).toBe(false);
    expect(crearCitaSchema.safeParse({ ...base, inicio: 'mañana' }).success).toBe(false);
    expect(crearCitaSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  test('reprogramarCitaSchema exige versión e inicio; cambiarEstadoSchema, un estado válido', () => {
    expect(reprogramarCitaSchema.safeParse({ version: 1, inicio: '2030-01-07T17:00:00-06:00' }).success).toBe(true);
    expect(reprogramarCitaSchema.safeParse({ inicio: '2030-01-07T17:00:00Z' }).success).toBe(false);
    expect(reprogramarCitaSchema.safeParse({ version: 0, inicio: '2030-01-07T17:00:00Z' }).success).toBe(false);
    expect(cambiarEstadoSchema.safeParse({ version: 2, estado: 'cancelada' }).success).toBe(true);
    expect(cambiarEstadoSchema.safeParse({ version: 2, estado: 'otra' }).success).toBe(false);
  });

  test('citaSchema acepta contacto sin email y notas ausentes', () => {
    const c = { id: U, medicoId: U, tipoCitaId: U, inicio: '2030-01-07T17:00:00.000Z', fin: '2030-01-07T17:30:00.000Z', estado: 'agendada', contacto: { nombre: 'P', telefono: '5555555555' }, fueraDeHorario: false, version: 1 };
    expect(citaSchema.safeParse(c).success).toBe(true);
  });
});

describe('eventos de cita (spec §3.5)', () => {
  const meta = { tenantId: U, actorId: U, traceId: 't' };
  const I = '2030-01-07T17:00:00.000Z';
  const F = '2030-01-07T17:30:00.000Z';
  /** Crea el sobre, lo serializa como viaja por el outbox y lo vuelve a validar. */
  const viaje = <T,>(def: EventDefinition<T>, data: T) => def.parse(JSON.parse(JSON.stringify(def.create({ ...meta, data }))));
  const conDatos = <T,>(def: EventDefinition<T>, valido: T, data: unknown) => () => def.parse({ ...def.create({ ...meta, data: valido }), data });

  test('son v1 y llevan su tipo', () => {
    const ev = CitaCancelada.create({ ...meta, data: { citaId: U, medicoId: U, inicio: I, fin: F } });
    expect(ev.type).toBe('cita.cancelada');
    expect(ev.version).toBe(1);
    expect(CitaCreada.type).toBe('cita.creada');
    expect(CitaReprogramada.type).toBe('cita.reprogramada');
    expect(CitaEstadoCambiado.type).toBe('cita.estado_cambiado');
  });

  test('cita.creada incluye estado y origen', () => {
    const data = { citaId: U, medicoId: U, tipoCitaId: U, inicio: I, fin: F, estado: 'agendada', origen: 'recepcion', fueraDeHorario: false } as const;
    expect(viaje(CitaCreada, data).data).toEqual(data);
    for (const falta of ['estado', 'origen'] as const) {
      const incompleto: Record<string, unknown> = { ...data };
      delete incompleto[falta];
      expect(conDatos(CitaCreada, data, incompleto)).toThrow();
    }
    expect(conDatos(CitaCreada, data, { ...data, origen: 'web' })).toThrow();
  });

  test('cita.reprogramada usa anterior: { medicoId, inicio, fin }', () => {
    const data = { citaId: U, medicoId: U, inicio: I, fin: F, anterior: { medicoId: U, inicio: '2030-01-07T16:00:00.000Z', fin: '2030-01-07T16:30:00.000Z' } };
    expect(viaje(CitaReprogramada, data).data).toEqual(data);
    expect(conDatos(CitaReprogramada, data, { citaId: U, medicoId: U, inicio: I, fin: F, medicoAnteriorId: U, inicioAnterior: I, finAnterior: F })).toThrow();
  });

  test('cita.estado_cambiado es { citaId, de, a } con los estados del contrato', () => {
    const data = { citaId: U, medicoId: U, de: 'agendada', a: 'confirmada' } as const;
    expect(viaje(CitaEstadoCambiado, data).data).toEqual(data);
    expect(conDatos(CitaEstadoCambiado, data, { ...data, a: 'otra' })).toThrow();
    expect(conDatos(CitaEstadoCambiado, data, { citaId: U, medicoId: U, estadoAnterior: 'agendada', estado: 'confirmada' })).toThrow();
  });

  test('los instantes exigen desfase y los ids son UUID', () => {
    const data = { citaId: U, medicoId: U, inicio: I, fin: F };
    expect(conDatos(CitaCancelada, data, { ...data, inicio: '2030-01-07T17:00:00' })).toThrow();
    expect(conDatos(CitaCancelada, data, { ...data, citaId: 'x' })).toThrow();
  });
});
