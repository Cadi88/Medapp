// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { claimsDelToken, necesitaRenovar } from '@/lib/sesion/token';
import { CLAIMS, jwtFalso, tokenQueVence } from '../apoyo/jwt.js';

const ahora = new Date('2026-11-11T16:00:00Z');

describe('necesitaRenovar', () => {
  test('necesitaRenovar: sin token, con 30 s restantes → true; con 10 min → false', () => {
    expect(necesitaRenovar(undefined, ahora)).toBe(true);
    expect(necesitaRenovar(tokenQueVence(ahora, 30), ahora)).toBe(true);
    expect(necesitaRenovar(tokenQueVence(ahora, 600), ahora)).toBe(false);
  });

  test('límite: con exactamente 60 s no renueva; vencido sí', () => {
    expect(necesitaRenovar(tokenQueVence(ahora, 60), ahora)).toBe(false);
    expect(necesitaRenovar(tokenQueVence(ahora, -5), ahora)).toBe(true);
  });

  test.each([['no-es-jwt'], ['a.%%%.c'], [jwtFalso({ sub: 'x' })], [jwtFalso({ exp: 'mañana' })]])(
    'token ilegible o sin exp numérico (%s) → renovar',
    (t) => expect(necesitaRenovar(t, ahora)).toBe(true),
  );
});

describe('claimsDelToken', () => {
  test('decodifica los claims del tenant con tokenClaimsSchema', () => {
    expect(claimsDelToken(tokenQueVence(ahora, 900))).toEqual(CLAIMS);
  });

  test('claims que no cumplen el contrato → error', () => {
    expect(() => claimsDelToken(jwtFalso({ ...CLAIMS, rol: 'dueño' }))).toThrow();
    expect(() => claimsDelToken('basura')).toThrow();
  });
});
