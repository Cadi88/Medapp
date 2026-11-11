import { describe, expect, test } from 'vitest';
import { ZodError } from 'zod';
import { COLUMNAS_EVENTO, construirListado, parseConsulta } from '../../src/consulta.js';

describe('parseConsulta', () => {
  test('limite por defecto 50', () => {
    expect(parseConsulta({})).toEqual({ limite: 50 });
  });
  test('acepta limite entre 1 y 200 (llega como string en la query)', () => {
    expect(parseConsulta({ limite: '1' }).limite).toBe(1);
    expect(parseConsulta({ limite: '200' }).limite).toBe(200);
  });
  test.each(['201', '0', '-1', '1.5', 'abc', ''])('rechaza limite=%s', (l) => {
    expect(() => parseConsulta({ limite: l })).toThrow(ZodError);
  });
  test('desde y hasta son fechas ISO y se normalizan a UTC', () => {
    expect(parseConsulta({ desde: '2026-01-01T00:00:00Z', hasta: '2026-01-02T00:00:00-06:00' })).toEqual({
      desde: '2026-01-01T00:00:00.000Z',
      hasta: '2026-01-02T06:00:00.000Z',
      limite: 50,
    });
  });
  test.each(['ayer', '2026-01-01', '2026-13-01T00:00:00Z'])('rechaza desde=%s', (d) => {
    expect(() => parseConsulta({ desde: d })).toThrow(ZodError);
  });
  test('rechaza desde posterior a hasta', () => {
    expect(() => parseConsulta({ desde: '2026-02-01T00:00:00Z', hasta: '2026-01-01T00:00:00Z' })).toThrow(ZodError);
  });
  test('rechaza parámetros desconocidos', () => {
    expect(() => parseConsulta({ foo: '1' })).toThrow(ZodError);
  });
});

describe('construirListado', () => {
  const T = '0194a1b2-0000-7000-8000-000000000001';
  test('siempre filtra por tenant y ordena por secuencia descendente', () => {
    const { text, values } = construirListado(T, { limite: 50 });
    expect(text).toBe(`SELECT ${COLUMNAS_EVENTO} FROM evento_auditoria WHERE tenant_id = $1 ORDER BY secuencia DESC LIMIT $2`);
    expect(values).toEqual([T, 50]);
  });
  test('añade desde/hasta como parámetros, nunca interpolados', () => {
    const { text, values } = construirListado(T, { desde: '2026-01-01T00:00:00.000Z', hasta: '2026-01-02T00:00:00.000Z', limite: 7 });
    expect(text).toContain('tenant_id = $1 AND ocurrido_en >= $2 AND ocurrido_en <= $3');
    expect(text).toMatch(/LIMIT \$4$/);
    expect(values).toEqual([T, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 7]);
    expect(text).not.toContain('2026');
  });
  test('solo hasta', () => {
    const { text, values } = construirListado(T, { hasta: '2026-01-02T00:00:00.000Z', limite: 1 });
    expect(text).toContain('tenant_id = $1 AND ocurrido_en <= $2');
    expect(values).toHaveLength(3);
  });
});
