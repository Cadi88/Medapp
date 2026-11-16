import { describe, expect, test } from 'vitest';
import { ventanaLocal } from '../../src/dominio/ventana.js';

const MX = 'America/Mexico_City';

describe('ventanaLocal', () => {
  test('un día: [00:00 local, 00:00 siguiente) en UTC', () => {
    expect(ventanaLocal('2030-01-07', '2030-01-07', MX)).toEqual({
      inicioUtc: new Date('2030-01-07T06:00:00Z'),
      finUtc: new Date('2030-01-08T06:00:00Z'),
    });
  });
  test('8 días inclusive es válido y 9 no', () => {
    expect('error' in ventanaLocal('2030-01-01', '2030-01-08', MX)).toBe(false);
    expect(ventanaLocal('2030-01-01', '2030-01-09', MX)).toHaveProperty('error');
  });
  test('rango invertido y fechas inválidas → error', () => {
    for (const [d, h] of [['2030-01-08', '2030-01-07'], ['2030-02-30', '2030-02-30'], ['2030-1-7', '2030-01-07'], ['x', 'y']] as const) {
      expect(ventanaLocal(d, h, MX)).toHaveProperty('error');
    }
  });
  test('día de cambio de horario (Nueva York, 2030-03-10: 23 horas)', () => {
    expect(ventanaLocal('2030-03-10', '2030-03-10', 'America/New_York')).toEqual({
      inicioUtc: new Date('2030-03-10T05:00:00Z'),
      finUtc: new Date('2030-03-11T04:00:00Z'),
    });
  });
  test('un rango que cruza el cambio de horario cuenta días de calendario', () => {
    expect('error' in ventanaLocal('2030-03-05', '2030-03-12', 'America/New_York')).toBe(false);
  });
});
