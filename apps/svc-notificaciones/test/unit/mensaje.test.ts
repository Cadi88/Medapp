import { describe, expect, test } from 'vitest';
import type { ConsultorioParaMensaje } from '@consultorio/contracts';
import { armarCorreo } from '../../src/correo/mensaje.js';
import { PLANTILLAS_POR_OMISION, type DatosPlantilla } from '../../src/dominio/plantillas.js';

const consultorio: ConsultorioParaMensaje = {
  nombreMostrado: 'Clínica <Sol>',
  telefono: '5512345678',
  colorPrimario: '#7c2d12',
  colorTexto: '#ffffff',
  logoKey: 'logos/t/x.png',
  zonaHoraria: 'America/Mexico_City',
  pais: 'MX',
};
const datos: DatosPlantilla = {
  paciente: 'Ana <b>',
  fecha: 'lunes 16 de noviembre',
  hora: '10:30',
  medico: 'Dra. Pérez',
  consultorio: 'Clínica <Sol>',
  telefono_consultorio: '55 1234 5678',
};
const enlaces = {
  confirmar: 'http://web.test/r/TOK?accion=confirma',
  cancelar: 'http://web.test/r/TOK?accion=cancela',
  cambiar: 'http://web.test/r/TOK?accion=pide_cambio',
};
const armar = (logo?: Uint8Array, c = consultorio) => armarCorreo({ plantillas: PLANTILLAS_POR_OMISION, datos, consultorio: c, ...(logo ? { logo } : {}), enlaces });

describe('armarCorreo', () => {
  test('incluye los tres enlaces, el color del consultorio y el logo como cid:logo', () => {
    const logo = new Uint8Array([1, 2, 3]);
    const c = armar(logo);
    for (const url of Object.values(enlaces)) {
      expect(c.html).toContain(`href="${url}"`);
      expect(c.texto).toContain(url);
    }
    expect(c.html).toContain('#7c2d12');
    expect(c.html).toContain('#ffffff');
    expect(c.html).toContain('src="cid:logo"');
    expect(c.adjuntos).toEqual([{ cid: 'logo', contenido: logo, tipo: 'image/png' }]);
    for (const boton of ['Confirmar', 'Cancelar', 'Pedir cambio']) expect(c.html).toContain(boton);
  });

  test('sin logo no adjunta nada ni referencia cid:logo', () => {
    const c = armar();
    expect(c.adjuntos).toEqual([]);
    expect(c.html).not.toContain('cid:logo');
  });

  test('el asunto va en texto plano (sin escapar) y el cuerpo HTML escapa los valores', () => {
    const c = armar();
    expect(c.asunto).toBe('Recordatorio de tu cita en Clínica <Sol>');
    expect(c.html).toContain('Ana &lt;b&gt;');
    expect(c.html).not.toContain('Ana <b>');
    expect(c.texto).toContain('Hola Ana <b>, te recordamos tu cita con Dra. Pérez el lunes 16 de noviembre a las 10:30');
  });

  test('color ausente o malformado usa el color por omisión (nunca se inyecta en el CSS)', () => {
    const c = armar(undefined, { ...consultorio, colorPrimario: 'red;}<script>', colorTexto: null });
    expect(c.html).not.toContain('script');
    expect(c.html).toMatch(/background-color:#[0-9a-f]{6}/);
  });

  test('el texto plano nombra el consultorio y lista las tres acciones', () => {
    const c = armar();
    expect(c.texto.startsWith('Clínica <Sol>')).toBe(true);
    expect(c.texto).toMatch(/Confirmar:/);
    expect(c.texto).toMatch(/Cancelar:/);
    expect(c.texto).toMatch(/Pedir cambio:/);
  });
});
