import { describe, expect, test } from 'vitest';
import { apiErrorSchema, rolSchema, tokenClaimsSchema } from '../../src/index.js';

const T = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const U = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

describe('tokenClaimsSchema', () => {
  test('acepta claims válidos', () => {
    expect(tokenClaimsSchema.parse({ sub: U, tid: T, rol: 'medico', mfa: true })).toEqual({ sub: U, tid: T, rol: 'medico', mfa: true });
  });
  test('exige tid y rol válido', () => {
    expect(tokenClaimsSchema.safeParse({ sub: U, rol: 'admin', mfa: true }).success).toBe(false);
    expect(tokenClaimsSchema.safeParse({ sub: U, tid: T, rol: 'root', mfa: true }).success).toBe(false);
  });
  test('rechaza sub no UUID y mfa no booleano', () => {
    expect(tokenClaimsSchema.safeParse({ sub: 'x', tid: T, rol: 'admin', mfa: true }).success).toBe(false);
    expect(tokenClaimsSchema.safeParse({ sub: U, tid: T, rol: 'admin', mfa: 'si' }).success).toBe(false);
  });
});

describe('rolSchema', () => {
  test.each(['admin', 'medico', 'recepcion'])('acepta %s', (r) => {
    expect(rolSchema.parse(r)).toBe(r);
  });
  test('rechaza otros', () => {
    expect(rolSchema.safeParse('paciente').success).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  test('acepta con y sin details', () => {
    expect(apiErrorSchema.safeParse({ code: 'VALIDACION', message: 'mal' }).success).toBe(true);
    expect(apiErrorSchema.safeParse({ code: 'CONFLICTO', message: 'dup', details: { campo: 'slug' } }).success).toBe(true);
  });
  test.each(['NO_AUTENTICADO', 'PROHIBIDO', 'MFA_REQUERIDA', 'VALIDACION', 'CONFLICTO', 'NO_ENCONTRADO', 'INTERNO'])('acepta código %s', (code) => {
    expect(apiErrorSchema.safeParse({ code, message: 'm' }).success).toBe(true);
  });
  test('rechaza código desconocido o sin message', () => {
    expect(apiErrorSchema.safeParse({ code: 'OTRO', message: 'm' }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ code: 'INTERNO' }).success).toBe(false);
  });
});
