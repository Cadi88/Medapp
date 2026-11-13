import { colorValidoSobreBlanco } from '@consultorio/contracts';
import { describe, expect, test } from 'vitest';
import {
  cambiosDePersonalizacion,
  errorDeColor,
  errorDeLogo,
  MAX_LOGO_BYTES,
} from '@/features/consultorio/logica/formulario';
import { PALETA, variablesDeTema } from '@/features/consultorio/logica/tema';

describe('tema', () => {
  test('variablesDeTema con color y sin color', () => {
    expect(variablesDeTema({ colorPrimario: '#1d4ed8', colorTexto: '#ffffff' })).toEqual({
      '--primary': '#1d4ed8',
      '--primary-foreground': '#ffffff',
    });
    expect(variablesDeTema({ colorPrimario: null, colorTexto: null })).toEqual({});
  });

  test('toda la PALETA pasa colorValidoSobreBlanco', () => {
    expect(PALETA).toHaveLength(8);
    expect(new Set(PALETA).size).toBe(8);
    expect(PALETA.every(colorValidoSobreBlanco)).toBe(true);
  });
});

describe('errorDeColor', () => {
  test('vacío y válido no tienen error; claro y mal formado sí', () => {
    expect(errorDeColor('')).toBeUndefined();
    expect(errorDeColor('#1d4ed8')).toBeUndefined();
    expect(errorDeColor('#ffff99')).toBe('Elige un color más oscuro');
    expect(errorDeColor('azul')).toBe('Color inválido (usa el formato #rrggbb)');
  });
});

describe('errorDeLogo', () => {
  test('acepta PNG, JPG y WebP de hasta 1 MB; rechaza lo demás con los textos de la spec', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(errorDeLogo({ size: MAX_LOGO_BYTES, type })).toBeUndefined();
    expect(errorDeLogo({ size: MAX_LOGO_BYTES + 1, type: 'image/png' })).toBe('El logo debe pesar menos de 1 MB');
    expect(errorDeLogo({ size: 10, type: 'image/gif' })).toBe('Sube una imagen PNG, JPG o WebP');
    expect(errorDeLogo({ size: 0, type: 'image/png' })).toBe('Sube una imagen PNG, JPG o WebP');
  });
});

describe('cambiosDePersonalizacion', () => {
  const actual = { nombreComercial: 'Dental Sol', direccion: null, telefono: '+525512345678', colorPrimario: '#1d4ed8' };

  test('solo incluye lo modificado y manda vacío como null', () => {
    expect(
      cambiosDePersonalizacion(actual, { nombreComercial: 'Dental Sol', direccion: '', telefono: '', colorPrimario: '#0f766e' }),
    ).toEqual({ telefono: null, colorPrimario: '#0f766e' });
  });

  test('sin cambios devuelve un objeto vacío; recorta espacios y pasa el color a minúsculas', () => {
    expect(cambiosDePersonalizacion(actual, { nombreComercial: ' Dental Sol ', direccion: '  ', telefono: '+525512345678', colorPrimario: '#1D4ED8' })).toEqual({});
    expect(cambiosDePersonalizacion(actual, { nombreComercial: ' Nuevo ', direccion: ' Calle 1 ' })).toEqual({
      nombreComercial: 'Nuevo',
      direccion: 'Calle 1',
    });
  });
});
