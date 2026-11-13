import { describe, expect, test } from 'vitest';
import { PAISES_HABILITADOS, normalizarTelefono, reglasDe, type CodigoPais } from '../../src/index.js';

describe('normalizarTelefono', () => {
  test.each([
    ['55 1234 5678', 'MX', '+525512345678'],
    ['+52 (55) 1234-5678', 'MX', '+525512345678'],
    ['+5215512345678', 'MX', '+525512345678'],
    ['55.1234.5678', 'MX', '+525512345678'],
    ['7123 4567', 'BO', '+59171234567'],
    ['+591 7123-4567', 'BO', '+59171234567'],
    ['12345', 'MX', null],
    ['+59171234567', 'MX', null],
    ['55123456789', 'MX', null],
    ['55 1234 abcd', 'MX', null],
    ['+5215512345678', 'BO', null],
    ['', 'MX', null],
  ])('normalizarTelefono(%s, %s) = %s', (e, p, r) => expect(normalizarTelefono(e, p as CodigoPais)).toBe(r));
});

describe('reglasDe', () => {
  test('México y Bolivia', () => {
    expect(reglasDe('MX')).toMatchObject({ codigo: 'MX', moneda: 'MXN', prefijoTelefonico: '+52', digitosNacionales: 10 });
    expect(reglasDe('BO')).toMatchObject({ codigo: 'BO', moneda: 'BOB', prefijoTelefonico: '+591', digitosNacionales: 8 });
    expect(reglasDe('MX').zonasHorarias).toContain('America/Mexico_City');
    expect(reglasDe('BO').zonasHorarias).toContain('America/La_Paz');
  });
  test('solo México está habilitado', () => expect(PAISES_HABILITADOS).toEqual(['MX']));
});
