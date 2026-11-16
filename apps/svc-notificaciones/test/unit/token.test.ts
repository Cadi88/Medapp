import { describe, expect, test } from 'vitest';
import { generarToken, hashDeToken } from '../../src/dominio/token.js';

describe('token de respuesta', () => {
  test('generarToken: 43 caracteres base64url y hash SHA-256 hex de 64', () => {
    const { token, hash } = generarToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeToken(token)).toBe(hash);
  });
  test('cada token es distinto y el hash no revela el token', () => {
    const a = generarToken();
    const b = generarToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).not.toContain(a.token);
  });
  test('hash conocido de SHA-256', () => {
    expect(hashDeToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
