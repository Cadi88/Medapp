import { describe, expect, test } from 'vitest';
import { resolverPersonalizacion, type ValoresPersonalizacion } from '../../src/dominio/personalizacion.js';

const vacio: ValoresPersonalizacion = { nombreComercial: null, direccion: null, telefono: null, colorPrimario: null };

describe('resolverPersonalizacion', () => {
  test('normaliza el teléfono a E.164 y reporta solo lo que cambia', () => {
    const r = resolverPersonalizacion({ telefono: '(55) 1234-5678', nombreComercial: 'Clínica Sol' }, 'MX', { ...vacio, nombreComercial: 'Clínica Sol' });
    expect(r).toEqual({ ok: true, nuevos: { ...vacio, nombreComercial: 'Clínica Sol', telefono: '+525512345678' }, cambiados: ['telefono'] });
  });
  test('sin cambios reales → cambiados vacío', () => {
    const actual = { ...vacio, telefono: '+525512345678', colorPrimario: '#1e3a8a' };
    const r = resolverPersonalizacion({ telefono: '5512345678', colorPrimario: '#1E3A8A' }, 'MX', actual);
    expect(r).toMatchObject({ ok: true, cambiados: [] });
  });
  test('null y cadena vacía borran el valor', () => {
    const actual = { nombreComercial: 'X Y', direccion: 'Calle 1', telefono: '+525512345678', colorPrimario: '#1e3a8a' };
    const r = resolverPersonalizacion({ direccion: null, telefono: '', colorPrimario: null }, 'MX', actual);
    expect(r).toEqual({ ok: true, nuevos: { ...actual, direccion: null, telefono: null, colorPrimario: null }, cambiados: ['direccion', 'telefono', 'colorPrimario'] });
  });
  test('teléfono inválido para el país → error de campo telefono', () => {
    expect(resolverPersonalizacion({ telefono: '123' }, 'MX', vacio)).toMatchObject({ ok: false, campo: 'telefono' });
    expect(resolverPersonalizacion({ telefono: '71234567' }, 'MX', vacio)).toMatchObject({ ok: false, campo: 'telefono' });
    expect(resolverPersonalizacion({ telefono: '71234567' }, 'BO', vacio)).toMatchObject({ ok: true, nuevos: { telefono: '+59171234567' } });
  });
  test('color con poco contraste sobre blanco o mal formado → "Elige un color más oscuro"', () => {
    for (const color of ['#fde68a', 'rojo', '#fff']) {
      expect(resolverPersonalizacion({ colorPrimario: color }, 'MX', vacio)).toEqual({ ok: false, campo: 'colorPrimario', mensaje: 'Elige un color más oscuro' });
    }
  });
  test('el color se guarda en minúsculas', () => {
    expect(resolverPersonalizacion({ colorPrimario: '#1E3A8A' }, 'MX', vacio)).toMatchObject({ ok: true, nuevos: { colorPrimario: '#1e3a8a' } });
  });
});
