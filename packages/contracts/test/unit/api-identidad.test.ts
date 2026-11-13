import { describe, expect, test } from 'vitest';
import { altaMiembroRespuestaSchema, consultorioSchema, editarMiembroSchema, miembroSchema, miembrosRespuestaSchema } from '../../src/index.js';

const U = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const base = {
  usuarioId: U,
  nombre: 'Ana',
  email: 'ana@ejemplo.mx',
  rol: 'medico',
  admin: false,
  mfaActivo: true,
  debeCambiarPassword: false,
  perfilMedico: { cedulaProfesional: '1234567', especialidad: null, cedulaEspecialidad: null, institucion: null },
};

describe('consultorioSchema', () => {
  test('acepta un consultorio y rechaza id no UUID', () => {
    const c = {
      id: U,
      nombre: 'C',
      slug: 'c-uno',
      zonaHoraria: 'America/Mexico_City',
      nombreComercial: null,
      direccion: null,
      telefono: null,
      colorPrimario: null,
      colorTexto: null,
      logoVersion: 0,
      pais: 'MX',
      moneda: 'MXN',
    };
    expect(consultorioSchema.parse(c)).toEqual(c);
    expect(consultorioSchema.safeParse({ ...c, id: 'x' }).success).toBe(false);
    expect(consultorioSchema.safeParse({ ...c, pais: 'AR' }).success).toBe(false);
    expect(consultorioSchema.parse({ ...c, colorPrimario: '#1e3a8a', colorTexto: '#ffffff', logoVersion: 3 }).logoVersion).toBe(3);
  });
});

describe('miembroSchema', () => {
  test('acepta miembro con y sin perfil médico', () => {
    expect(miembroSchema.parse(base)).toEqual(base);
    expect(miembroSchema.parse({ ...base, rol: 'recepcion', perfilMedico: null }).perfilMedico).toBeNull();
  });
  test('rechaza rol inválido y campos faltantes', () => {
    expect(miembroSchema.safeParse({ ...base, rol: 'admin' }).success).toBe(false);
    expect(miembroSchema.safeParse({ ...base, mfaActivo: undefined }).success).toBe(false);
  });
  test('respuesta de lista', () => {
    expect(miembrosRespuestaSchema.parse({ miembros: [base] }).miembros).toHaveLength(1);
  });
});

describe('editarMiembroSchema', () => {
  test.each([{ rol: 'recepcion' }, { admin: false }, { rol: 'medico', admin: true }])('acepta %j', (b) => {
    expect(editarMiembroSchema.safeParse(b).success).toBe(true);
  });
  test.each([{}, { rol: 'admin' }, { admin: 'si' }, { rol: 'medico', extra: 1 }])('rechaza %j', (b) => {
    expect(editarMiembroSchema.safeParse(b).success).toBe(false);
  });
});

describe('altaMiembroRespuestaSchema (POST /miembros)', () => {
  test('incluye cuentaCreada: si es false, la contraseña temporal no se aplicó', () => {
    const r = { usuarioId: U, rol: 'recepcion', admin: false, cuentaCreada: false };
    expect(altaMiembroRespuestaSchema.parse(r)).toEqual(r);
    expect(altaMiembroRespuestaSchema.safeParse({ usuarioId: U, rol: 'recepcion', admin: false }).success).toBe(false);
    expect(altaMiembroRespuestaSchema.safeParse({ ...r, rol: 'admin' }).success).toBe(false);
  });
});
