import { describe, expect, test } from 'vitest';
import {
  bloqueHorarioSchema,
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
