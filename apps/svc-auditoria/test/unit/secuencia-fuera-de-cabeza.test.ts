import { describe, expect, test } from 'vitest';
import { secuenciaFueraDeCabeza } from '../../src/verificacion.js';

describe('secuenciaFueraDeCabeza', () => {
  test('total = ultima y max <= ultima → sin problema', () => {
    expect(secuenciaFueraDeCabeza(4n, 4n, 4n)).toBeUndefined();
    expect(secuenciaFueraDeCabeza(0n, null, 0n)).toBeUndefined();
  });
  test('registros más allá del encabezado (cabeza rebajada) → ultima + 1', () => {
    expect(secuenciaFueraDeCabeza(2n, 4n, 4n)).toBe(3);
  });
  test('sin encabezado (ultima = 0) pero con registros → 1', () => {
    expect(secuenciaFueraDeCabeza(0n, 2n, 2n)).toBe(1);
  });
  test('el total no cuadra aunque max no exceda → ultima + 1', () => {
    expect(secuenciaFueraDeCabeza(3n, 3n, 2n)).toBe(4);
  });
});
