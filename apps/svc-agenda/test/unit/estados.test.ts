import { describe, expect, test } from 'vitest';
import { pideCambioTras, puedeReprogramar, transicionPermitida } from '../../src/dominio/estados.js';
import type { EstadoCita } from '../../src/dominio/tipos.js';

const TODOS: EstadoCita[] = ['agendada', 'confirmada', 'atendida', 'cancelada', 'no_asistio'];

describe('pideCambioTras', () => {
  test('confirmar la cita (el personal o recepción por el paciente) cierra el "pide cambio"; los demás estados lo conservan', () => {
    expect(pideCambioTras('confirmada', true)).toBe(false);
    expect(pideCambioTras('confirmada', false)).toBe(false);
    for (const e of ['agendada', 'atendida', 'cancelada', 'no_asistio'] as EstadoCita[]) {
      expect(pideCambioTras(e, true)).toBe(true);
      expect(pideCambioTras(e, false)).toBe(false);
    }
  });
});

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
