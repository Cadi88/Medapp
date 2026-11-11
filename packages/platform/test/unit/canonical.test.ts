import { describe, expect, test } from 'vitest';
import { canonicalJson, sha256Hex } from '../../src/index.js';

describe('canonicalJson', () => {
  test('ordena claves recursivamente y es estable', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
  });
  test('mismo resultado sin importar el orden de inserción', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
  test('omite undefined en propiedades de objetos', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
  test('primitivos, null y strings con escapes', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(1.5)).toBe('1.5');
  });
  test('undefined en la raíz no es serializable', () => {
    expect(() => canonicalJson(undefined)).toThrow();
  });
  test('acepta objetos con prototipo null', () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.b = 1;
    o.a = 2;
    expect(canonicalJson(o)).toBe('{"a":2,"b":1}');
  });
  test('0 negativo, anidamiento y arreglos vacíos', () => {
    expect(canonicalJson({ a: [], b: {}, c: -0 })).toBe('{"a":[],"b":{},"c":0}');
  });

  describe('rechaza valores que no son JSON plano', () => {
    class Punto {
      x = 1;
    }
    const casos: [string, unknown][] = [
      ['Date', new Date('2026-01-01T00:00:00Z')],
      ['Buffer', Buffer.from('a')],
      ['Uint8Array', new Uint8Array(2)],
      ['Map', new Map()],
      ['Set', new Set()],
      ['función', () => 1],
      ['símbolo', Symbol('s')],
      ['bigint', 1n],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['undefined dentro de un arreglo', [1, undefined]],
      ['hueco en un arreglo', [1, , 2]],
      ['instancia de clase', new Punto()],
      ['Date anidado', { a: [{ d: new Date() }] }],
      ['función como propiedad', { f: () => 1 }],
      ['símbolo como propiedad', { s: Symbol('x') }],
    ];
    test.each(casos)('%s', (_n, v) => {
      expect(() => canonicalJson(v)).toThrow(/canonicalJson/);
    });
    test('referencia circular', () => {
      const a: Record<string, unknown> = {};
      a.self = a;
      expect(() => canonicalJson(a)).toThrow(/circular/);
    });
    test('el mismo objeto repetido (no circular) es válido', () => {
      const x = { v: 1 };
      expect(canonicalJson({ a: x, b: [x, x] })).toBe('{"a":{"v":1},"b":[{"v":1},{"v":1}]}');
    });
  });
});

describe('sha256Hex', () => {
  test('vector conocido', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
