import { describe, expect, test } from 'vitest';
import { registroSchema } from '../../src/routes/registro.js';

const base = {
  nombreConsultorio: 'Consultorio Uno',
  slug: 'consultorio-uno',
  zonaHoraria: 'America/Mexico_City',
  admin: { nombre: 'Ana Pérez', email: 'Ana@Ejemplo.MX', password: 'una-clave-larga' },
};
const con = (cambio: Record<string, unknown>) => ({ ...base, ...cambio });

describe('registroSchema', () => {
  test('acepta un cuerpo válido y normaliza el email a minúsculas', () => {
    const r = registroSchema.parse(base);
    expect(r.admin.email).toBe('ana@ejemplo.mx');
    expect(r.slug).toBe('consultorio-uno');
  });

  test.each([
    ['zona inválida', con({ zonaHoraria: 'Mars/Base' })],
    ['slug con mayúsculas', con({ slug: 'Uno' })],
    ['slug muy corto', con({ slug: 'ab' })],
    ['slug muy largo', con({ slug: 'a'.repeat(41) })],
    ['slug con caracteres no permitidos', con({ slug: 'uno_dos' })],
    ['nombre de consultorio corto', con({ nombreConsultorio: 'A' })],
    ['nombre de consultorio largo', con({ nombreConsultorio: 'A'.repeat(121) })],
    ['password corta', con({ admin: { ...base.admin, password: '123' } })],
    ['password de 9 caracteres', con({ admin: { ...base.admin, password: '123456789' } })],
    ['email inválido', con({ admin: { ...base.admin, email: 'no-es-email' } })],
    ['nombre de admin vacío', con({ admin: { ...base.admin, nombre: '' } })],
    ['sin admin', con({ admin: undefined })],
  ])('%s se rechaza', (_n, cuerpo) => {
    expect(registroSchema.safeParse(cuerpo).success).toBe(false);
  });

  test('acepta password de exactamente 10 caracteres y slug de 3 y 40', () => {
    expect(registroSchema.safeParse(con({ admin: { ...base.admin, password: '1234567890' } })).success).toBe(true);
    expect(registroSchema.safeParse(con({ slug: 'abc' })).success).toBe(true);
    expect(registroSchema.safeParse(con({ slug: 'a'.repeat(40) })).success).toBe(true);
  });

  test('rechaza campos desconocidos', () => {
    expect(registroSchema.safeParse(con({ rol: 'admin' })).success).toBe(false);
  });
});
