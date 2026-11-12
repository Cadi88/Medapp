import { describe, expect, test } from 'vitest';
import { encajaEnHorario, seEnciman, validarSemana } from '../../src/dominio/horario.js';
import { rangoDeCita } from '../../src/dominio/tiempo.js';
import type { BloqueHorario } from '../../src/dominio/tipos.js';

const CDMX = 'America/Mexico_City';
const lunes: BloqueHorario[] = [{ diaSemana: 1, horaInicio: '09:00', horaFin: '14:00' }];

describe('encajaEnHorario', () => {
  test('encaja: 10:00–10:30 en bloque 09:00–14:00 de CDMX', () => {
    expect(encajaEnHorario(rangoDeCita('2026-11-16T16:00:00Z', 30), lunes, CDMX)).toBe(true);
  });
  test('encaja justo en los bordes del bloque', () => {
    expect(encajaEnHorario(rangoDeCita('2026-11-16T15:00:00Z', 30), lunes, CDMX)).toBe(true);
    expect(encajaEnHorario(rangoDeCita('2026-11-16T19:30:00Z', 30), lunes, CDMX)).toBe(true);
  });
  test('no encaja si termina después del bloque', () => {
    expect(encajaEnHorario(rangoDeCita('2026-11-16T19:45:00Z', 30), lunes, CDMX)).toBe(false);
  });
  test('no encaja si empieza antes del bloque', () => {
    expect(encajaEnHorario(rangoDeCita('2026-11-16T14:45:00Z', 30), lunes, CDMX)).toBe(false);
  });
  test('no encaja en otro día de la semana', () => {
    expect(encajaEnHorario(rangoDeCita('2026-11-17T16:00:00Z', 30), lunes, CDMX)).toBe(false);
  });
  test('no puede abarcar dos bloques del mismo día', () => {
    const partido: BloqueHorario[] = [
      { diaSemana: 1, horaInicio: '09:00', horaFin: '11:00' },
      { diaSemana: 1, horaInicio: '11:00', horaFin: '14:00' },
    ];
    expect(encajaEnHorario(rangoDeCita('2026-11-16T16:45:00Z', 30), partido, CDMX)).toBe(false);
    expect(encajaEnHorario(rangoDeCita('2026-11-16T17:00:00Z', 30), partido, CDMX)).toBe(true);
  });
  test('Review Focus 1: cita 23:30–00:30 local nunca encaja', () => {
    const todo: BloqueHorario[] = ([0, 1, 2, 3, 4, 5, 6] as const).map((d) => ({
      diaSemana: d,
      horaInicio: '00:00',
      horaFin: '23:59',
    }));
    // 23:30 local del lunes 2026-11-16 = 05:30Z del martes
    expect(encajaEnHorario(rangoDeCita('2026-11-17T05:30:00Z', 60), todo, CDMX)).toBe(false);
    // termina exactamente a medianoche: tampoco encaja
    expect(encajaEnHorario(rangoDeCita('2026-11-17T05:30:00Z', 30), todo, CDMX)).toBe(false);
  });
  test('Review Focus 1: Tijuana día de cambio de horario (2026-03-08) usa el día local correcto', () => {
    const tj = 'America/Tijuana';
    const domingo: BloqueHorario[] = [{ diaSemana: 0, horaInicio: '09:00', horaFin: '12:00' }];
    // 09:00 PDT (UTC-7) = 16:00Z
    expect(encajaEnHorario(rangoDeCita('2026-03-08T16:00:00Z', 30), domingo, tj)).toBe(true);
    // 15:30Z = 08:30 PDT, antes del bloque
    expect(encajaEnHorario(rangoDeCita('2026-03-08T15:30:00Z', 30), domingo, tj)).toBe(false);
    // 05:00Z del día 8 sigue siendo sábado 21:00 local: pertenece al bloque de sábado
    const sabado: BloqueHorario[] = [{ diaSemana: 6, horaInicio: '20:00', horaFin: '23:00' }];
    expect(encajaEnHorario(rangoDeCita('2026-03-08T05:00:00Z', 30), sabado, tj)).toBe(true);
    expect(encajaEnHorario(rangoDeCita('2026-03-08T05:00:00Z', 30), domingo, tj)).toBe(false);
  });
});

describe('seEnciman', () => {
  const a = rangoDeCita('2026-11-16T15:00:00Z', 30);
  test('solapados', () => {
    expect(seEnciman(a, rangoDeCita('2026-11-16T15:15:00Z', 30))).toBe(true);
    expect(seEnciman(rangoDeCita('2026-11-16T15:15:00Z', 30), a)).toBe(true);
    expect(seEnciman(a, a)).toBe(true);
  });
  test('contiguos no se enciman (semiabierto)', () => {
    expect(seEnciman(a, rangoDeCita('2026-11-16T15:30:00Z', 30))).toBe(false);
    expect(seEnciman(rangoDeCita('2026-11-16T14:30:00Z', 30), a)).toBe(false);
  });
  test('disjuntos', () => {
    expect(seEnciman(a, rangoDeCita('2026-11-16T18:00:00Z', 30))).toBe(false);
  });
});

describe('validarSemana', () => {
  test('acepta una semana válida y bloques contiguos', () => {
    expect(validarSemana([])).toEqual({ ok: true });
    expect(
      validarSemana([
        { diaSemana: 1, horaInicio: '09:00', horaFin: '11:00' },
        { diaSemana: 1, horaInicio: '11:00', horaFin: '14:00' },
        { diaSemana: 2, horaInicio: '09:00', horaFin: '14:00' },
      ]),
    ).toEqual({ ok: true });
  });
  test('rechaza bloques encimados y formato inválido', () => {
    const encimados = validarSemana([
      { diaSemana: 1, horaInicio: '09:00', horaFin: '12:00' },
      { diaSemana: 1, horaInicio: '11:00', horaFin: '14:00' },
    ]);
    expect(encimados.ok).toBe(false);
    const formatos: [string, string][] = [
      ['9:00', '10:00'],
      ['09:00', '24:00'],
      ['09:60', '10:00'],
      ['09:00', 'abc'],
    ];
    for (const [horaInicio, horaFin] of formatos) {
      expect(validarSemana([{ diaSemana: 1, horaInicio, horaFin }]).ok).toBe(false);
    }
  });
  test('rechaza inicio >= fin y día inválido', () => {
    expect(validarSemana([{ diaSemana: 1, horaInicio: '10:00', horaFin: '10:00' }]).ok).toBe(false);
    expect(validarSemana([{ diaSemana: 1, horaInicio: '11:00', horaFin: '10:00' }]).ok).toBe(false);
    expect(validarSemana([{ diaSemana: 7 as 0, horaInicio: '09:00', horaFin: '10:00' }]).ok).toBe(false);
  });
});
