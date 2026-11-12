import { DateTime } from 'luxon';
import { describe, expect, test } from 'vitest';
import { huecosLibres } from '../../src/dominio/disponibilidad.js';
import { rangoDeCita as rango } from '../../src/dominio/tiempo.js';
import type { BloqueHorario } from '../../src/dominio/tipos.js';

const CDMX = 'America/Mexico_City';
const ahoraLejano = DateTime.fromISO('2026-01-01T00:00:00Z');

describe('huecosLibres', () => {
  test('huecos: bloque 09–11, 30 min, cita 09:30 → [09:00, 10:00, 10:30] en UTC', () => {
    expect(
      huecosLibres({
        fecha: '2026-11-16',
        zona: CDMX,
        bloques: [{ diaSemana: 1, horaInicio: '09:00', horaFin: '11:00' }],
        ocupados: [rango('2026-11-16T15:30:00Z', 30)],
        duracionMin: 30,
        ahora: DateTime.fromISO('2026-11-01T00:00:00Z'),
      }),
    ).toEqual(['2026-11-16T15:00:00.000Z', '2026-11-16T16:00:00.000Z', '2026-11-16T16:30:00.000Z']);
  });

  test('huecos: nunca en el pasado; día sin bloques → []', () => {
    const base = {
      fecha: '2026-11-16',
      zona: CDMX,
      bloques: [{ diaSemana: 1, horaInicio: '09:00', horaFin: '11:00' }] as BloqueHorario[],
      ocupados: [],
      duracionMin: 30,
    };
    // ahora = 10:00 local (16:00Z): 10:00 todavía cuenta, 09:00 y 09:30 no
    expect(huecosLibres({ ...base, ahora: DateTime.fromISO('2026-11-16T16:00:00Z') })).toEqual([
      '2026-11-16T16:00:00.000Z',
      '2026-11-16T16:30:00.000Z',
    ]);
    expect(huecosLibres({ ...base, ahora: DateTime.fromISO('2026-11-17T00:00:00Z') })).toEqual([]);
    expect(huecosLibres({ ...base, fecha: '2026-11-17', ahora: ahoraLejano })).toEqual([]);
  });

  test('el último hueco debe terminar dentro del bloque', () => {
    expect(
      huecosLibres({
        fecha: '2026-11-16',
        zona: CDMX,
        bloques: [{ diaSemana: 1, horaInicio: '09:00', horaFin: '10:45' }],
        ocupados: [],
        duracionMin: 30,
        ahora: ahoraLejano,
      }),
    ).toEqual(['2026-11-16T15:00:00.000Z', '2026-11-16T15:30:00.000Z', '2026-11-16T16:00:00.000Z']);
  });

  test('una ocupación que cruza quita los huecos que toca', () => {
    const r = huecosLibres({
      fecha: '2026-11-16',
      zona: CDMX,
      bloques: [{ diaSemana: 1, horaInicio: '09:00', horaFin: '11:00' }],
      ocupados: [rango('2026-11-16T15:15:00Z', 60)], // 09:15–10:15 local
      duracionMin: 30,
      ahora: ahoraLejano,
    });
    expect(r).toEqual(['2026-11-16T16:30:00.000Z']);
  });

  test('varios bloques salen ordenados y solo los del día de la semana', () => {
    const r = huecosLibres({
      fecha: '2026-11-16',
      zona: CDMX,
      bloques: [
        { diaSemana: 1, horaInicio: '16:00', horaFin: '17:00' },
        { diaSemana: 1, horaInicio: '09:00', horaFin: '10:00' },
        { diaSemana: 2, horaInicio: '09:00', horaFin: '10:00' },
      ],
      ocupados: [],
      duracionMin: 60,
      ahora: ahoraLejano,
    });
    expect(r).toEqual(['2026-11-16T15:00:00.000Z', '2026-11-16T22:00:00.000Z']);
  });

  test('Tijuana 2026-03-08: omite las horas locales inexistentes (02:00–02:59)', () => {
    const r = huecosLibres({
      fecha: '2026-03-08',
      zona: 'America/Tijuana',
      bloques: [{ diaSemana: 0, horaInicio: '01:30', horaFin: '04:00' }],
      ocupados: [],
      duracionMin: 30,
      ahora: ahoraLejano,
    });
    // 01:30 PST = 09:30Z; 02:00 y 02:30 no existen; 03:00 PDT = 10:00Z; 03:30 PDT = 10:30Z
    expect(r).toEqual(['2026-03-08T09:30:00.000Z', '2026-03-08T10:00:00.000Z', '2026-03-08T10:30:00.000Z']);
  });

  test('Tijuana 2026-03-08: las horas normales usan el offset del día (PDT)', () => {
    const r = huecosLibres({
      fecha: '2026-03-08',
      zona: 'America/Tijuana',
      bloques: [{ diaSemana: 0, horaInicio: '09:00', horaFin: '10:00' }],
      ocupados: [],
      duracionMin: 30,
      ahora: ahoraLejano,
    });
    expect(r).toEqual(['2026-03-08T16:00:00.000Z', '2026-03-08T16:30:00.000Z']);
  });

  test('Tijuana 2026-11-01: la hora ambigua (01:00–01:59) se toma una sola vez', () => {
    const r = huecosLibres({
      fecha: '2026-11-01',
      zona: 'America/Tijuana',
      bloques: [{ diaSemana: 0, horaInicio: '01:00', horaFin: '02:00' }],
      ocupados: [],
      duracionMin: 30,
      ahora: ahoraLejano,
    });
    expect(r).toHaveLength(2);
    expect(new Set(r).size).toBe(2);
  });
});
