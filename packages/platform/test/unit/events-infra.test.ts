import { describe, expect, test } from 'vitest';
import { backoffInfraPorDefecto, decidirFalloInfra, esErrorDeInfraestructura, PRESUPUESTO_INFRA_MS } from '../../src/events/consumer.js';

const conCodigo = (code: string, message = 'x') => Object.assign(new Error(message), { code });

describe('esErrorDeInfraestructura', () => {
  test.each(['08000', '08003', '08006', '08001', '08004', '08P01', '57P01', '57P02', '57P03', '53300'])('SQLSTATE %s → sí', (c) => {
    expect(esErrorDeInfraestructura(conCodigo(c))).toBe(true);
  });
  test.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'])('código de red %s → sí', (c) => {
    expect(esErrorDeInfraestructura(conCodigo(c))).toBe(true);
  });
  test.each([
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout',
    'Connection terminated unexpectedly',
    'Connection terminated',
    'Client has encountered a connection error and is not queryable',
  ])('mensaje de pg/pg-pool "%s" → sí', (m) => {
    expect(esErrorDeInfraestructura(new Error(m))).toBe(true);
  });
  test('busca en la cadena de `cause` y en AggregateError.errors', () => {
    expect(esErrorDeInfraestructura(new Error('envoltura', { cause: conCodigo('ECONNRESET') }))).toBe(true);
    expect(esErrorDeInfraestructura(new AggregateError([new Error('a'), conCodigo('ECONNREFUSED')], 'varios'))).toBe(true);
  });
  test.each([
    ['violación de unicidad', conCodigo('23505')],
    ['error de sintaxis', conCodigo('42601')],
    ['tabla inexistente', conCodigo('42P01')],
    ['53 sin ser 53300 (disco lleno)', conCodigo('53100')],
    ['57014 (cancelada)', conCodigo('57014')],
    ['error del handler', new Error('boom')],
    ['mensaje parecido no exacto', new Error('mi handler: Connection terminated por lógica')],
  ])('%s → no', (_n, err) => {
    expect(esErrorDeInfraestructura(err)).toBe(false);
  });
  test.each([undefined, null, 'ECONNRESET', 42, {}])('valor no error %j → no', (v) => {
    expect(esErrorDeInfraestructura(v)).toBe(false);
  });
  test('una cadena de cause cíclica no cuelga', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(esErrorDeInfraestructura(a)).toBe(false);
  });
});

describe('decidirFalloInfra', () => {
  const t0 = 1_700_000_000_000;
  test('reintenta mientras no se agote el presupuesto (30 min desde el timestamp del mensaje), sin importar las entregas', () => {
    expect(PRESUPUESTO_INFRA_MS).toBe(30 * 60_000);
    expect(decidirFalloInfra(t0, t0 + 1000)).toBe('reintentar');
    expect(decidirFalloInfra(t0, t0 + PRESUPUESTO_INFRA_MS - 1)).toBe('reintentar');
    expect(decidirFalloInfra(t0, t0 + PRESUPUESTO_INFRA_MS)).toBe('dlq');
    expect(decidirFalloInfra(t0, t0 + 10 * PRESUPUESTO_INFRA_MS)).toBe('dlq');
  });
  test('presupuesto configurable', () => {
    expect(decidirFalloInfra(t0, t0 + 500, 1000)).toBe('reintentar');
    expect(decidirFalloInfra(t0, t0 + 1000, 1000)).toBe('dlq');
  });
});

describe('backoffInfraPorDefecto', () => {
  test('exponencial desde 1 s con tope de 60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffInfraPorDefecto)).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000]);
    expect(backoffInfraPorDefecto(100)).toBe(60_000);
  });
});
