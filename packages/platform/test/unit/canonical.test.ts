import { describe, expect, test } from 'vitest';
import { canonicalJson, sha256Hex } from '../../src/index.js';

describe('canonicalJson', () => {
  test('ordena claves recursivamente y es estable', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
  });
  test('mismo resultado sin importar el orden de inserción', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
  test('omite undefined en objetos pero lo vuelve null en arreglos', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([1, undefined])).toBe('[1,null]');
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
  test('Date se serializa como ISO', () => {
    expect(canonicalJson({ d: new Date('2026-01-01T00:00:00Z') })).toBe('{"d":"2026-01-01T00:00:00.000Z"}');
  });
});

describe('sha256Hex', () => {
  test('vector conocido', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
