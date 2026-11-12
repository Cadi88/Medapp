import { describe, expect, test } from 'vitest';
import { puedeReprogramar, transicionPermitida } from '../../src/dominio/estados.js';
import type { EstadoCita } from '../../src/dominio/tipos.js';

const TODOS: EstadoCita[] = ['agendada', 'confirmada', 'atendida', 'cancelada', 'no_asistio'];

describe('transicionPermitida', () => {
  test('transiciones', () => {
    expect(transicionPermitida('agendada', 'atendida')).toBe(true);
    expect(transicionPermitida('cancelada', 'agendada')).toBe(false);
    expect(transicionPermitida('confirmada', 'agendada')).toBe(false);
  });

  test.each([
    ['agendada', ['confirmada', 'atendida', 'cancelada', 'no_asistio']],
    ['confirmada', ['atendida', 'cancelada', 'no_asistio']],
    ['atendida', []],
    ['cancelada', []],
    ['no_asistio', []],
  ] as [EstadoCita, EstadoCita[]][])('desde %s', (de, permitidos) => {
    for (const a of TODOS) expect(transicionPermitida(de, a)).toBe(permitidos.includes(a));
  });
});

describe('puedeReprogramar', () => {
  test('solo agendada o confirmada', () => {
    expect(TODOS.filter(puedeReprogramar)).toEqual(['agendada', 'confirmada']);
  });
});
