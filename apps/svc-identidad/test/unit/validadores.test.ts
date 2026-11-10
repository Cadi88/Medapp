import { describe, expect, test } from 'vitest';
import { datosFiscalesSchema, miembroSchema, perfilSchema, tenantBodySchema } from '../../src/validadores.js';

const fiscales = { rfc: 'XAXX010101000', razonSocial: 'Clinica SA de CV', regimenFiscal: '601', cp: '06600' };

describe('RFC', () => {
  test.each(['XAXX010101000', 'GODE561231GR8', 'ÑAB010101AB1', 'A&B010101AB1'])('acepta %s', (rfc) => {
    expect(datosFiscalesSchema.parse({ ...fiscales, rfc }).rfc).toBe(rfc);
  });
  test('se pasa a mayusculas y se recortan espacios antes de validar', () => {
    expect(datosFiscalesSchema.parse({ ...fiscales, rfc: ' xaxx010101000 ' }).rfc).toBe('XAXX010101000');
  });
  test.each(['', 'XAXX0101010', 'XA010101000', 'XAXX01010100000', '1AXX010101000', 'XAXX01010!000'])('rechaza %j', (rfc) => {
    expect(datosFiscalesSchema.safeParse({ ...fiscales, rfc }).success).toBe(false);
  });
  test('un RFC que no es cadena se rechaza', () => {
    expect(datosFiscalesSchema.safeParse({ ...fiscales, rfc: 123 }).success).toBe(false);
  });
});

describe('regimen fiscal y CP', () => {
  test.each(['60', '6011', 'abc', ''])('regimen %j invalido', (regimenFiscal) => {
    expect(datosFiscalesSchema.safeParse({ ...fiscales, regimenFiscal }).success).toBe(false);
  });
  test.each(['0660', '066001', 'abcde', ''])('cp %j invalido', (cp) => {
    expect(datosFiscalesSchema.safeParse({ ...fiscales, cp }).success).toBe(false);
  });
  test('razon social vacia y campos extra se rechazan', () => {
    expect(datosFiscalesSchema.safeParse({ ...fiscales, razonSocial: '' }).success).toBe(false);
    expect(datosFiscalesSchema.safeParse({ ...fiscales, pacEmisorId: 'x' }).success).toBe(false);
  });
});

describe('perfil medico', () => {
  test.each(['1234567', '12345678'])('cedula %s valida', (cedulaProfesional) => {
    expect(perfilSchema.parse({ cedulaProfesional }).cedulaProfesional).toBe(cedulaProfesional);
  });
  test.each(['123456', '123456789', 'ABC4567', '1234 567', ''])('cedula %j invalida', (cedulaProfesional) => {
    expect(perfilSchema.safeParse({ cedulaProfesional }).success).toBe(false);
  });
  test('campos opcionales y limites', () => {
    expect(
      perfilSchema.parse({ cedulaProfesional: '1234567', especialidad: 'Cardiologia', cedulaEspecialidad: '7654321', institucion: 'UNAM' }),
    ).toMatchObject({ especialidad: 'Cardiologia' });
    expect(perfilSchema.safeParse({ cedulaProfesional: '1234567', especialidad: 'x'.repeat(201) }).success).toBe(false);
    expect(perfilSchema.safeParse({ cedulaProfesional: '1234567', otro: 1 }).success).toBe(false);
  });
});

describe('miembro y cuerpo de sesion', () => {
  const base = { email: 'Nuevo@Ejemplo.MX', nombre: 'Nuevo', rol: 'recepcion', passwordTemporal: 'clave-temporal-123' };
  test('normaliza el email a minusculas', () => {
    expect(miembroSchema.parse(base).email).toBe('nuevo@ejemplo.mx');
  });
  test.each([
    ['rol desconocido', { rol: 'root' }],
    ['password corta', { passwordTemporal: '123' }],
    ['email invalido', { email: 'nope' }],
    ['nombre vacio', { nombre: '' }],
  ])('%s', (_n, cambio) => {
    expect(miembroSchema.safeParse({ ...base, ...cambio }).success).toBe(false);
  });
  test('tenantId debe ser UUID', () => {
    expect(tenantBodySchema.safeParse({ tenantId: 'no-uuid' }).success).toBe(false);
    expect(tenantBodySchema.safeParse({}).success).toBe(false);
    expect(tenantBodySchema.safeParse({ tenantId: '0190aaaa-0000-7000-8000-000000000001' }).success).toBe(true);
  });
});
