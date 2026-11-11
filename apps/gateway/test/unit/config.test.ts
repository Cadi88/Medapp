import { describe, expect, test } from 'vitest';
import { leerConfig, parseConfiarEnProxy } from '../../src/config.js';

const base = { JWKS_URL: 'http://i/jwks', IDENTIDAD_URL: 'http://i', AUDITORIA_URL: 'http://a' };

describe('parseConfiarEnProxy', () => {
  test.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['true', true],
    ['10.0.0.0/8', '10.0.0.0/8'],
    ['10.0.0.0/8, 172.16.0.0/12', '10.0.0.0/8,172.16.0.0/12'],
  ])('%s → %s', (v, esperado) => {
    expect(parseConfiarEnProxy(v)).toEqual(esperado);
  });
  test('un número de saltos se rechaza (Fastify 5 no confía en nadie con un entero)', () => {
    expect(() => parseConfiarEnProxy('1')).toThrow(/CIDR/);
  });
});

describe('leerConfig', () => {
  test('valores por defecto', () => {
    expect(leerConfig(base)).toEqual({
      port: 3000,
      jwksUrl: 'http://i/jwks',
      destinos: { identidad: 'http://i', auditoria: 'http://a' },
      confiarEnProxy: false,
      limitePublicoPorMin: 60,
    });
  });
  test('valores explícitos', () => {
    const c = leerConfig({ ...base, PORT: '8080', CONFIAR_EN_PROXY: '10.0.0.0/8', LIMITE_PUBLICO_POR_MIN: '5' });
    expect(c).toMatchObject({ port: 8080, confiarEnProxy: '10.0.0.0/8', limitePublicoPorMin: 5 });
  });
  test('falta variable requerida', () => {
    expect(() => leerConfig({ ...base, JWKS_URL: undefined })).toThrow(/JWKS_URL/);
  });
  test('límite inválido', () => {
    expect(() => leerConfig({ ...base, LIMITE_PUBLICO_POR_MIN: '0' })).toThrow(/LIMITE_PUBLICO_POR_MIN/);
    expect(() => leerConfig({ ...base, LIMITE_PUBLICO_POR_MIN: 'abc' })).toThrow(/LIMITE_PUBLICO_POR_MIN/);
  });
  test('puerto inválido', () => {
    expect(() => leerConfig({ ...base, PORT: 'x' })).toThrow(/PORT/);
  });
});
