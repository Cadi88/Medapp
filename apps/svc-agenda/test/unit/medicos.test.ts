import { describe, expect, test } from 'vitest';
import { aplicarEventoMedico } from '../../src/dominio/medicos.js';

describe('aplicarEventoMedico', () => {
  test.each([
    [null, { tipo: 'vinculado', rol: 'medico', nombre: 'Dra. A' }, { nombre: 'Dra. A', activo: true }],
    [null, { tipo: 'vinculado', rol: 'recepcion', nombre: 'R' }, null],
    [{ nombre: 'Dra. A', activo: true }, { tipo: 'actualizado', rol: 'recepcion', nombre: 'Dra. A' }, { nombre: 'Dra. A', activo: false }],
    [{ nombre: 'Dra. A', activo: true }, { tipo: 'desvinculado' }, { nombre: 'Dra. A', activo: false }],
  ] as const)('%j + %j → %j', (actual, e, esperado) => {
    expect(aplicarEventoMedico(actual ? { ...actual } : null, { ...e })).toEqual(esperado);
  });

  test('desvincular a quien no existe no crea nada', () => {
    expect(aplicarEventoMedico(null, { tipo: 'desvinculado' })).toBeNull();
  });

  test('actualizado con rol medico reactiva y renombra', () => {
    expect(aplicarEventoMedico({ nombre: 'Vieja', activo: false }, { tipo: 'actualizado', rol: 'medico', nombre: 'Nueva' })).toEqual({ nombre: 'Nueva', activo: true });
  });

  test('sin nombre en el evento conserva el nombre actual o queda vacío', () => {
    expect(aplicarEventoMedico({ nombre: 'Dra. A', activo: false }, { tipo: 'vinculado', rol: 'medico' })).toEqual({ nombre: 'Dra. A', activo: true });
    expect(aplicarEventoMedico(null, { tipo: 'vinculado', rol: 'medico' })).toEqual({ nombre: '', activo: true });
  });

  test('actualizado a recepcion renombra sin reactivar', () => {
    expect(aplicarEventoMedico({ nombre: 'X', activo: true }, { tipo: 'actualizado', rol: 'recepcion', nombre: 'Y' })).toEqual({ nombre: 'Y', activo: false });
  });

  test('no muta la entrada', () => {
    const actual = { nombre: 'A', activo: true };
    aplicarEventoMedico(actual, { tipo: 'desvinculado' });
    expect(actual).toEqual({ nombre: 'A', activo: true });
  });
});
