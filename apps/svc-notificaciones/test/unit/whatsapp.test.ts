import { describe, expect, test } from 'vitest';
import { enlaceWhatsApp } from '../../src/dominio/whatsapp.js';

describe('enlaceWhatsApp', () => {
  test('normaliza +52 y codifica el mensaje', () => {
    expect(enlaceWhatsApp('55 1234 5678', 'MX', 'Hola Ana & Luis, ¿vienes?')).toBe(
      `https://wa.me/525512345678?text=${encodeURIComponent('Hola Ana & Luis, ¿vienes?')}`,
    );
    expect(enlaceWhatsApp('+52 55 1234 5678', 'MX', 'x')).toBe('https://wa.me/525512345678?text=x');
  });
  test('devuelve null si el teléfono no es válido', () => {
    expect(enlaceWhatsApp('123', 'MX', 'x')).toBeNull();
    expect(enlaceWhatsApp('', 'MX', 'x')).toBeNull();
  });
});
