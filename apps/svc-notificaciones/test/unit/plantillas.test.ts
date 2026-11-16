import { describe, expect, test } from 'vitest';
import { PLANTILLAS_POR_OMISION, rellenar, validarPlantillas, type DatosPlantilla } from '../../src/dominio/plantillas.js';

const datos: DatosPlantilla = {
  paciente: 'Ana & Luis',
  fecha: 'lunes 16 de noviembre',
  hora: '10:30',
  medico: 'Dra. Pérez',
  consultorio: 'Clínica <Sol>',
  telefono_consultorio: '55 1234 5678',
};

describe('rellenar', () => {
  test('sustituye campos, escapa HTML en modo html y deja {desconocido} tal cual', () => {
    expect(rellenar('Hola {paciente} <b>', { paciente: 'Ana & Luis' } as DatosPlantilla, { html: true })).toBe('Hola Ana &amp; Luis &lt;b&gt;');
    expect(rellenar('Hola {x} {paciente}', datos, { html: false })).toBe('Hola {x} Ana & Luis');
  });
  test('modo texto no escapa; escapa comillas y apóstrofos en html', () => {
    expect(rellenar('{consultorio}', datos, { html: false })).toBe('Clínica <Sol>');
    expect(rellenar('{paciente}', { ...datos, paciente: `"O'Neil"` }, { html: true })).toBe('&quot;O&#39;Neil&quot;');
  });
  test('un valor con llaves no se vuelve a sustituir', () => {
    expect(rellenar('{paciente} {medico}', { ...datos, paciente: '{medico}' }, { html: false })).toBe('{medico} Dra. Pérez');
  });
});

describe('validarPlantillas', () => {
  const ok = { correoAsunto: 'a'.repeat(120), correoCuerpo: 'b'.repeat(1000), whatsapp: 'c'.repeat(700) };
  test('acepta los límites exactos y las plantillas por omisión', () => {
    expect(validarPlantillas(ok)).toEqual({ ok: true });
    expect(validarPlantillas(PLANTILLAS_POR_OMISION)).toEqual({ ok: true });
  });
  test('rechaza asunto de 121 caracteres, cuerpo de 1001 y WhatsApp de 701', () => {
    expect(validarPlantillas({ ...ok, correoAsunto: 'a'.repeat(121) })).toMatchObject({ ok: false, campo: 'correoAsunto' });
    expect(validarPlantillas({ ...ok, correoCuerpo: 'b'.repeat(1001) })).toMatchObject({ ok: false, campo: 'correoCuerpo' });
    expect(validarPlantillas({ ...ok, whatsapp: 'c'.repeat(701) })).toMatchObject({ ok: false, campo: 'whatsapp' });
  });
  test('rechaza plantillas vacías', () => {
    expect(validarPlantillas({ ...ok, whatsapp: '  ' })).toMatchObject({ ok: false, campo: 'whatsapp' });
  });
});
