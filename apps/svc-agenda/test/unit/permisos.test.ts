import { describe, expect, test } from 'vitest';
import { puedeGestionarMedico } from '../../src/dominio/permisos.js';

describe('puedeGestionarMedico', () => {
  test('Review Focus 5: médico no gestiona a otro médico; recepción y admin sí', () => {
    expect(puedeGestionarMedico({ sub: 'm1', rol: 'medico', admin: false }, 'm2')).toBe(false);
    expect(puedeGestionarMedico({ sub: 'm1', rol: 'medico', admin: false }, 'm1')).toBe(true);
    expect(puedeGestionarMedico({ sub: 'r1', rol: 'recepcion', admin: false }, 'm2')).toBe(true);
    expect(puedeGestionarMedico({ sub: 'm1', rol: 'medico', admin: true }, 'm2')).toBe(true);
  });
});
