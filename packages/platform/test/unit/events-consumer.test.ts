import { describe, expect, test } from 'vitest';
import { backoffPorDefecto, decidirFallo, cabecerasDlq } from '../../src/events/consumer.js';

describe('decidirFallo', () => {
  test.each([
    [1, 5, 'reintentar'],
    [4, 5, 'reintentar'],
    [5, 5, 'dlq'],
    [6, 5, 'dlq'],
    [1, 1, 'dlq'],
  ] as const)('entrega %i de %i -> %s', (n, max, esperado) => {
    expect(decidirFallo(n, max)).toBe(esperado);
  });
});

describe('backoffPorDefecto', () => {
  test('exponencial desde 1 s con tope de 30 s', () => {
    expect([1, 2, 3, 4, 5].map(backoffPorDefecto)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(backoffPorDefecto(10)).toBe(30_000);
  });
});

describe('cabecerasDlq', () => {
  test('lleva el mensaje de error y el número de entregas', () => {
    expect(cabecerasDlq(new Error('boom'), 5)).toEqual({ 'x-error': 'boom', 'x-entregas': '5' });
    expect(cabecerasDlq('texto', 1)).toEqual({ 'x-error': 'texto', 'x-entregas': '1' });
  });

  test('colapsa saltos de línea y trunca (las cabeceras NATS no admiten CR/LF)', () => {
    expect(cabecerasDlq(new Error('a\r\n  b\nc'), 2)['x-error']).toBe('a b c');
    expect(cabecerasDlq(new Error('x'.repeat(900)), 2)['x-error']).toHaveLength(500);
  });
});
