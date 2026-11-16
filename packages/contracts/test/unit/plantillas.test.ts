import { describe, expect, test } from 'vitest';
import {
  CAMPOS_PLANTILLA,
  errorDePlantilla,
  LIMITES_PLANTILLA,
  rellenarPlantilla,
  validarPlantillas,
  type DatosPlantilla,
} from '../../src/recordatorios/plantillas.js';

const datos: DatosPlantilla = {
  paciente: 'Ana',
  fecha: 'jueves 19 de noviembre',
  hora: '10:00',
  medico: 'Dra. Ruiz',
  consultorio: 'Dental Sol',
  telefono_consultorio: '+525512345678',
};

describe('rellenarPlantilla', () => {
  test('sustituye los campos conocidos y deja los desconocidos', () => {
    expect(rellenarPlantilla('Hola {paciente} en {consultorio} {otro}', datos)).toBe('Hola Ana en Dental Sol {otro}');
  });

  test('una sola pasada: un valor con llaves no se vuelve a sustituir', () => {
    expect(rellenarPlantilla('{paciente} {medico}', { ...datos, paciente: '{medico}' })).toBe('{medico} Dra. Ruiz');
  });

  test('un campo heredado del prototipo no cuenta', () => {
    expect(rellenarPlantilla('{constructor}', datos)).toBe('{constructor}');
  });

  test('un valor ausente deja el campo tal cual', () => {
    expect(rellenarPlantilla('{paciente}', { paciente: undefined } as unknown as DatosPlantilla)).toBe('{paciente}');
  });

  test('con escape: se aplica a la plantilla y a los valores', () => {
    const esc = (s: string) => s.replace(/</g, '&lt;');
    expect(rellenarPlantilla('<b>{paciente}', { ...datos, paciente: '<i>' }, esc)).toBe('&lt;b>&lt;i>');
  });
});

describe('plantillas', () => {
  const ok = { correoAsunto: 'a', correoCuerpo: 'b', whatsapp: 'c' };

  test('límites y campos', () => {
    expect(LIMITES_PLANTILLA).toEqual({ correoAsunto: 120, correoCuerpo: 1000, whatsapp: 700 });
    expect(CAMPOS_PLANTILLA).toEqual(['paciente', 'fecha', 'hora', 'medico', 'consultorio', 'telefono_consultorio']);
  });

  test('errorDePlantilla: vacía, justo en el límite y pasada', () => {
    expect(errorDePlantilla('whatsapp', '  ')).toBe('La plantilla no puede estar vacía');
    expect(errorDePlantilla('whatsapp', 'x'.repeat(700))).toBeUndefined();
    expect(errorDePlantilla('whatsapp', 'x'.repeat(701))).toBe('Máximo 700 caracteres');
  });

  test('validarPlantillas devuelve el primer campo con error', () => {
    expect(validarPlantillas(ok)).toEqual({ ok: true });
    expect(validarPlantillas({ ...ok, correoCuerpo: 'x'.repeat(1001) })).toEqual({ ok: false, campo: 'correoCuerpo', error: 'Máximo 1000 caracteres' });
    expect(validarPlantillas({ ...ok, correoAsunto: '' })).toMatchObject({ ok: false, campo: 'correoAsunto' });
  });
});
