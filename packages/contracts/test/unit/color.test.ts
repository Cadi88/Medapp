import { expect, test } from 'vitest';
import { colorDeTexto, colorValidoSobreBlanco, contraste } from '../../src/index.js';

test('colorDeTexto elige el de mayor contraste', () => {
  expect(colorDeTexto('#1e3a8a')).toBe('#ffffff');
  expect(colorDeTexto('#fde68a')).toBe('#000000');
});
test('colorValidoSobreBlanco: azul oscuro sí, amarillo pálido no, formato inválido no', () => {
  expect(colorValidoSobreBlanco('#1e3a8a')).toBe(true);
  expect(colorValidoSobreBlanco('#fde68a')).toBe(false);
  expect(colorValidoSobreBlanco('#1E3A8A')).toBe(false);
  expect(colorValidoSobreBlanco('azul')).toBe(false);
});
test('contraste blanco/negro = 21 y es simétrico', () => {
  expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 1);
  expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 1);
  expect(contraste('#777777', '#777777')).toBeCloseTo(1, 5);
});
