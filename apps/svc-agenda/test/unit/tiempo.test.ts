import { describe, expect, test } from 'vitest';
import { rangoDeCita } from '../../src/dominio/tiempo.js';

describe('rangoDeCita', () => {
  test('fin = inicio + duración, en UTC', () => {
    const r = rangoDeCita('2026-11-16T09:00:00-06:00', 30);
    expect(r.inicio.toISO()).toBe('2026-11-16T15:00:00.000Z');
    expect(r.fin.toISO()).toBe('2026-11-16T15:30:00.000Z');
    expect(r.inicio.zoneName).toBe('UTC');
  });

  test('rechaza fecha inválida o duración no positiva', () => {
    expect(() => rangoDeCita('no-es-fecha', 30)).toThrow();
    expect(() => rangoDeCita('2026-11-16T15:00:00Z', 0)).toThrow();
    expect(() => rangoDeCita('2026-11-16T15:00:00Z', 1.5)).toThrow();
  });
});
