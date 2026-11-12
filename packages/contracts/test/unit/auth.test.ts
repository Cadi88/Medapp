import { describe, expect, test } from 'vitest';
import { apiErrorSchema, rolSchema, tokenClaimsSchema } from '../../src/index.js';

const T = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const U = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

describe('tokenClaimsSchema', () => {
  test('acepta claims válidos', () => {
    const c = { sub: U, tid: T, rol: 'medico', admin: true, mfa: true };
    expect(tokenClaimsSchema.parse(c)).toEqual(c);
  });
  test('exige tid, rol de trabajo válido y admin booleano', () => {
    expect(tokenClaimsSchema.safeParse({ sub: U, rol: 'medico', admin: false, mfa: true }).success).toBe(false);
    expect(tokenClaimsSchema.safeParse({ sub: U, tid: T, rol: 'root', admin: false, mfa: true }).success).toBe(false);
    expect(tokenClaimsSchema.safeParse({ sub: U, tid: T, rol: 'admin', admin: true, mfa: true }).success).toBe(false);
    expect(tokenClaimsSchema.safeParse({ sub: U, tid: T, rol: 'medico', mfa: true }).success).toBe(false);
    expect(tokenClaimsSchema.safeParse({ sub: U, tid: T, rol: 'medico', admin: 'si', mfa: true }).success).toBe(false);
  });
  test('rechaza sub no UUID y mfa no booleano', () => {
    expect(tokenClaimsSchema.safeParse({ sub: 'x', tid: T, rol: 'medico', admin: false, mfa: true }).success).toBe(false);
    expect(tokenClaimsSchema.safeParse({ sub: U, tid: T, rol: 'medico', admin: false, mfa: 'si' }).success).toBe(false);
  });
});

describe('rolSchema', () => {
  test.each(['medico', 'recepcion'])('acepta %s', (r) => {
    expect(rolSchema.parse(r)).toBe(r);
  });
  test.each(['admin', 'paciente'])('rechaza %s', (r) => {
    expect(rolSchema.safeParse(r).success).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  test('acepta con y sin details', () => {
    expect(apiErrorSchema.safeParse({ code: 'VALIDACION', message: 'mal' }).success).toBe(true);
    expect(apiErrorSchema.safeParse({ code: 'CONFLICTO', message: 'dup', details: { campo: 'slug' } }).success).toBe(true);
  });
  test.each([
    'NO_AUTENTICADO',
    'PROHIBIDO',
    'MFA_REQUERIDA',
    'VALIDACION',
    'CONFLICTO',
    'NO_ENCONTRADO',
    'INTERNO',
    'PASSWORD_TEMPORAL',
    'FUERA_DE_HORARIO',
    'HORARIO_OCUPADO',
    'HORARIO_BLOQUEADO',
    'CONFLICTO_VERSION',
  ])('acepta código %s', (code) => {
    expect(apiErrorSchema.safeParse({ code, message: 'm' }).success).toBe(true);
  });
  test('rechaza código desconocido o sin message', () => {
    expect(apiErrorSchema.safeParse({ code: 'OTRO', message: 'm' }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ code: 'INTERNO' }).success).toBe(false);
  });
});
