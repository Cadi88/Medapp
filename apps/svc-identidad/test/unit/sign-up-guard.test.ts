import { describe, expect, test } from 'vitest';
import { esAltaDirecta } from '../../src/sign-up-guard.js';

describe('esAltaDirecta', () => {
  test.each([
    ['/sign-up/email', true, true],
    ['/sign-up/otro', true, true],
    ['/sign-up', true, true],
    ['/auth/sign-up/email', true, true],
    ['/auth/sign-up/email?x=1', true, true],
    ['/Auth/SIGN-UP/email', true, true],
    ['/auth/sign-up/email', false, false],
    ['/sign-up/email', false, false],
    ['/sign-in/email', true, false],
    ['/two-factor/enable', true, false],
    ['/get-session', true, false],
    ['/auth/sign-upx', true, false],
  ])('%s (con request: %s) → %s', (ruta, conRequest, esperado) => {
    expect(esAltaDirecta(ruta, conRequest)).toBe(esperado);
  });
});
