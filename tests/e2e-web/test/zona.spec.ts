import { expect, test } from '@playwright/test';
import { zonaParaCitaDeHoy } from './apoyo.js';

// Sin navegador: solo la elección de zona con instantes fijos (noviembre: Ciudad de México es UTC-6).
test.describe('zonaParaCitaDeHoy', () => {
  const cdmx = (hhmm: string) => Date.parse(`2026-11-16T${hhmm}:00-06:00`);
  test('22:59 en Ciudad de México → Ciudad de México', () => expect(zonaParaCitaDeHoy(cdmx('22:59'))).toBe('America/Mexico_City'));
  test('23:00 y 23:55 → Tijuana', () => {
    expect(zonaParaCitaDeHoy(cdmx('23:00'))).toBe('America/Tijuana');
    expect(zonaParaCitaDeHoy(cdmx('23:55'))).toBe('America/Tijuana');
  });
  test('madrugada → Ciudad de México', () => expect(zonaParaCitaDeHoy(cdmx('00:05'))).toBe('America/Mexico_City'));
});
