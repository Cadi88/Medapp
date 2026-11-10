import { describe, expect, test } from 'vitest';
import { decidirToken, exigeMfa, puedeEditarPerfil, puedeEliminarMiembro } from '../../src/reglas.js';

describe('MFA obligatorio por rol', () => {
  test.each([
    ['admin', true],
    ['medico', true],
    ['recepcion', false],
  ] as const)('exigeMfa(%s) = %s', (rol, esperado) => {
    expect(exigeMfa(rol)).toBe(esperado);
  });
});

describe('decidirToken (rol x twoFactorEnabled)', () => {
  test.each([
    ['admin', true, { ok: true, mfa: true }],
    ['admin', false, { ok: false }],
    ['medico', true, { ok: true, mfa: true }],
    ['medico', false, { ok: false }],
    ['recepcion', true, { ok: true, mfa: true }],
    ['recepcion', false, { ok: true, mfa: false }],
  ] as const)('%s con twoFactorEnabled=%s', (rol, twoFactorEnabled, esperado) => {
    expect(decidirToken({ rol, twoFactorEnabled })).toEqual(esperado);
  });

  test('twoFactorEnabled nulo o indefinido cuenta como falso', () => {
    expect(decidirToken({ rol: 'admin', twoFactorEnabled: null })).toEqual({ ok: false });
    expect(decidirToken({ rol: 'recepcion', twoFactorEnabled: undefined })).toEqual({ ok: true, mfa: false });
  });
});

describe('puedeEliminarMiembro (ultimo admin)', () => {
  test('no se elimina al unico admin', () => {
    expect(puedeEliminarMiembro({ rolObjetivo: 'admin', admins: 1 })).toBe(false);
  });
  test('con dos admins se puede eliminar uno', () => {
    expect(puedeEliminarMiembro({ rolObjetivo: 'admin', admins: 2 })).toBe(true);
  });
  test('cero admins visibles tampoco permite eliminar a un admin', () => {
    expect(puedeEliminarMiembro({ rolObjetivo: 'admin', admins: 0 })).toBe(false);
  });
  test.each(['medico', 'recepcion'] as const)('un %s siempre se puede eliminar', (rolObjetivo) => {
    expect(puedeEliminarMiembro({ rolObjetivo, admins: 1 })).toBe(true);
  });
});

describe('puedeEditarPerfil', () => {
  const yo = '0190aaaa-0000-7000-8000-000000000001';
  const otro = '0190aaaa-0000-7000-8000-000000000002';
  test('admin edita a cualquiera', () => {
    expect(puedeEditarPerfil({ rol: 'admin', solicitanteId: yo, objetivoId: otro })).toBe(true);
  });
  test('medico edita solo su propio perfil', () => {
    expect(puedeEditarPerfil({ rol: 'medico', solicitanteId: yo, objetivoId: yo })).toBe(true);
    expect(puedeEditarPerfil({ rol: 'medico', solicitanteId: yo, objetivoId: otro })).toBe(false);
  });
  test('recepcion nunca', () => {
    expect(puedeEditarPerfil({ rol: 'recepcion', solicitanteId: yo, objetivoId: yo })).toBe(false);
  });
});
