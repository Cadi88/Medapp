import { describe, expect, test } from 'vitest';
import { proximaEjecucion } from '../../src/programador.js';

// America/Mexico_City es UTC-6 todo el año desde 2022 (sin horario de verano): 03:00 local = 09:00 UTC.
describe('proximaEjecucion', () => {
  const iso = (d: string, zona?: string) => proximaEjecucion(new Date(d), zona).toISOString();

  test('antes de las 03:00 locales → hoy a las 03:00', () => {
    expect(iso('2026-06-10T08:59:59Z')).toBe('2026-06-10T09:00:00.000Z');
  });
  test('exactamente a las 03:00 → mañana', () => {
    expect(iso('2026-06-10T09:00:00Z')).toBe('2026-06-11T09:00:00.000Z');
  });
  test('después de las 03:00 → mañana', () => {
    expect(iso('2026-06-10T15:00:00Z')).toBe('2026-06-11T09:00:00.000Z');
  });
  test('cerca de la medianoche local (23:59 del 10 = 05:59Z del 11) → el 11 a las 03:00 locales', () => {
    expect(iso('2026-06-11T05:59:00Z')).toBe('2026-06-11T09:00:00.000Z');
  });
  test('justo después de la medianoche local (00:01 del 11 = 06:01Z) → ese mismo día a las 03:00', () => {
    expect(iso('2026-06-11T06:01:00Z')).toBe('2026-06-11T09:00:00.000Z');
  });
  test('la fecha local, no la UTC, decide el día', () => {
    expect(iso('2026-06-10T23:00:00Z')).toBe('2026-06-11T09:00:00.000Z');
  });
  test('cruce de fin de año', () => {
    expect(iso('2026-12-31T20:00:00Z')).toBe('2027-01-01T09:00:00.000Z');
  });
  test('fin de mes', () => {
    expect(iso('2026-02-28T12:00:00Z')).toBe('2026-03-01T09:00:00.000Z');
  });
  test('respeta el horario de verano de otra zona (New_York: 03:00 EDT = 07:00Z, EST = 08:00Z)', () => {
    expect(iso('2026-07-01T00:00:00Z', 'America/New_York')).toBe('2026-07-01T07:00:00.000Z');
    expect(iso('2026-01-15T00:00:00Z', 'America/New_York')).toBe('2026-01-15T08:00:00.000Z');
  });
  test('siempre es posterior a ahora y a lo sumo 24 h después', () => {
    for (let h = 0; h < 48; h++) {
      const ahora = new Date(Date.UTC(2026, 5, 10, h, 17));
      const p = proximaEjecucion(ahora);
      expect(p.getTime()).toBeGreaterThan(ahora.getTime());
      expect(p.getTime() - ahora.getTime()).toBeLessThanOrEqual(24 * 3600_000);
    }
  });
});
