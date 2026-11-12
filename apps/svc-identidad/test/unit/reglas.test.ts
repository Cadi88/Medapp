import { describe, expect, test } from 'vitest';
import { decidirToken, exigeMfa, puedeEditarPerfil, puedeQuitarAdmin, rolFundador } from '../../src/dominio/reglas.js';

describe('MFA obligatorio (rol médico o permiso admin)', () => {
  test.each([
    [{ rol: 'medico', admin: false }, true],
    [{ rol: 'medico', admin: true }, true],
    [{ rol: 'recepcion', admin: true }, true],
    [{ rol: 'recepcion', admin: false }, false],
  ] as const)('exigeMfa(%o) = %s', (m, esperado) => {
    expect(exigeMfa(m)).toBe(esperado);
  });
});

describe('decidirToken (rol x admin x twoFactorEnabled)', () => {
  test.each([
    ['medico', false, true, { ok: true, mfa: true }],
    ['medico', false, false, { ok: false, motivo: 'MFA_REQUERIDA' }],
    ['medico', true, false, { ok: false, motivo: 'MFA_REQUERIDA' }],
    ['recepcion', true, true, { ok: true, mfa: true }],
    ['recepcion', true, false, { ok: false, motivo: 'MFA_REQUERIDA' }],
    ['recepcion', false, true, { ok: true, mfa: true }],
    ['recepcion', false, false, { ok: true, mfa: false }],
  ] as const)('%s admin=%s twoFactorEnabled=%s', (rol, admin, twoFactorEnabled, esperado) => {
    expect(decidirToken({ rol, admin, twoFactorEnabled, debeCambiarPassword: false })).toEqual(esperado);
  });

  test('twoFactorEnabled nulo o indefinido cuenta como falso', () => {
    expect(decidirToken({ rol: 'medico', admin: false, twoFactorEnabled: null, debeCambiarPassword: false })).toEqual({ ok: false, motivo: 'MFA_REQUERIDA' });
    expect(decidirToken({ rol: 'recepcion', admin: false, twoFactorEnabled: undefined, debeCambiarPassword: false })).toEqual({ ok: true, mfa: false });
  });
});

describe('puedeQuitarAdmin (último admin)', () => {
  test('no se quita al único admin', () => {
    expect(puedeQuitarAdmin({ esAdminObjetivo: true, admins: 1 })).toBe(false);
  });
  test('con dos admins se puede quitar uno', () => {
    expect(puedeQuitarAdmin({ esAdminObjetivo: true, admins: 2 })).toBe(true);
  });
  test('cero admins visibles tampoco permite quitar a un admin', () => {
    expect(puedeQuitarAdmin({ esAdminObjetivo: true, admins: 0 })).toBe(false);
  });
  test('quien no es admin siempre se puede quitar', () => {
    expect(puedeQuitarAdmin({ esAdminObjetivo: false, admins: 1 })).toBe(true);
  });
});

describe('rolFundador', () => {
  test('esMedico decide el rol de trabajo del fundador', () => {
    expect(rolFundador(true)).toBe('medico');
    expect(rolFundador(false)).toBe('recepcion');
  });
});

describe('puedeEditarPerfil', () => {
  const yo = '0190aaaa-0000-7000-8000-000000000001';
  const otro = '0190aaaa-0000-7000-8000-000000000002';
  test('admin edita a cualquiera, sea cual sea su rol', () => {
    expect(puedeEditarPerfil({ rol: 'recepcion', admin: true, solicitanteId: yo, objetivoId: otro })).toBe(true);
    expect(puedeEditarPerfil({ rol: 'medico', admin: true, solicitanteId: yo, objetivoId: otro })).toBe(true);
  });
  test('médico no admin edita solo su propio perfil', () => {
    expect(puedeEditarPerfil({ rol: 'medico', admin: false, solicitanteId: yo, objetivoId: yo })).toBe(true);
    expect(puedeEditarPerfil({ rol: 'medico', admin: false, solicitanteId: yo, objetivoId: otro })).toBe(false);
  });
  test('recepción no admin nunca', () => {
    expect(puedeEditarPerfil({ rol: 'recepcion', admin: false, solicitanteId: yo, objetivoId: yo })).toBe(false);
  });
});
