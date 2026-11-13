import { describe, expect, test } from 'vitest';
import {
  cambioPasswordSchema,
  elegirConsultorioSchema,
  erroresDeZod,
  loginSchema,
  registroSchema,
  textosDe,
  totpSchema,
  zonasDeAmerica,
  ZONA_POR_OMISION,
} from '@/features/sesion/logica/validaciones';

const registroValido = {
  nombreConsultorio: 'Consultorio Dental Sol',
  slug: 'dental-sol',
  zonaHoraria: 'America/Mexico_City',
  esMedico: true,
  nombre: 'Ana López',
  email: 'ana@ejemplo.mx',
  password: 'una-clave-larga',
  pais: 'MX',
};

describe('validaciones de formularios', () => {
  test('slug con mayúsculas y TOTP de 5 dígitos dan mensajes en español', () => {
    const r = registroSchema.safeParse({ ...registroValido, slug: 'Dental-Sol' });
    expect(r.success).toBe(false);
    if (!r.success) expect(erroresDeZod(r.error).slug).toMatch(/minúsculas/);

    const t = totpSchema.safeParse({ codigo: '12345' });
    expect(t.success).toBe(false);
    if (!t.success) expect(erroresDeZod(t.error)).toEqual({ codigo: 'El código debe tener 6 dígitos' });
  });

  test('registro válido pasa; zona inexistente y contraseña corta fallan', () => {
    expect(registroSchema.safeParse(registroValido).success).toBe(true);
    const r = registroSchema.safeParse({ ...registroValido, zonaHoraria: 'Marte/Olimpo', password: 'corta' });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(erroresDeZod(r.error)).sort()).toEqual(['password', 'zonaHoraria']);
  });

  test('registro: el país es MX por omisión; Bolivia aún no está habilitada', () => {
    const sinPais: Record<string, unknown> = { ...registroValido };
    delete sinPais.pais;
    const r = registroSchema.safeParse(sinPais);
    expect(r.success && r.data.pais).toBe('MX');
    const bo = registroSchema.safeParse({ ...registroValido, pais: 'BO' });
    expect(bo.success).toBe(false);
    if (!bo.success) expect(erroresDeZod(bo.error).pais).toBe('Elige un país disponible');
  });

  test('registro: campos vacíos o ausentes dan mensajes por campo', () => {
    const r = registroSchema.safeParse({ ...registroValido, nombreConsultorio: '  ', email: 'no-es-correo', nombre: undefined });
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = erroresDeZod(r.error);
      expect(e.nombreConsultorio).toMatch(/obligatorio/);
      expect(e.email).toMatch(/correo válido/);
      expect(e.nombre).toMatch(/obligatorio/);
    }
  });

  test('TOTP acepta espacios entre grupos y los normaliza', () => {
    expect(totpSchema.parse({ codigo: '123 456' })).toEqual({ codigo: '123456' });
    expect(totpSchema.safeParse({ codigo: '12a456' }).success).toBe(false);
  });

  test('login: correo inválido y contraseña vacía', () => {
    const r = loginSchema.safeParse({ email: 'x', password: '' });
    expect(r.success).toBe(false);
    if (!r.success) expect(erroresDeZod(r.error)).toEqual({ email: 'Escribe un correo válido', password: 'La contraseña es obligatoria' });
    expect(loginSchema.parse({ email: ' Ana@Ejemplo.mx ', password: 'x' }).email).toBe('Ana@Ejemplo.mx');
  });

  test('cambio de contraseña: no coincide y es igual a la actual', () => {
    const a = cambioPasswordSchema.safeParse({ actual: 'temporal-123', nueva: 'una-clave-larga', confirmacion: 'otra-clave-larga' });
    expect(a.success).toBe(false);
    if (!a.success) expect(erroresDeZod(a.error)).toEqual({ confirmacion: 'Las contraseñas no coinciden' });
    const b = cambioPasswordSchema.safeParse({ actual: 'una-clave-larga', nueva: 'una-clave-larga', confirmacion: 'una-clave-larga' });
    expect(b.success).toBe(false);
    if (!b.success) expect(erroresDeZod(b.error).nueva).toMatch(/distinta/);
    expect(cambioPasswordSchema.safeParse({ actual: 'x', nueva: 'una-clave-larga', confirmacion: 'una-clave-larga' }).success).toBe(true);
  });

  test('elegir consultorio exige un UUID', () => {
    expect(elegirConsultorioSchema.safeParse({ tenantId: 'abc' }).success).toBe(false);
    expect(elegirConsultorioSchema.safeParse({}).success).toBe(false);
    expect(elegirConsultorioSchema.safeParse({ tenantId: '0190a0a0-0000-7000-8000-000000000001' }).success).toBe(true);
  });

  test('erroresDeZod: un error sin ruta va bajo "_"', () => {
    const r = totpSchema.safeParse('no-es-objeto');
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(erroresDeZod(r.error))).toEqual(['_']);
  });

  test('zonas: solo America/* e incluye la de omisión', () => {
    const zonas = zonasDeAmerica();
    expect(zonas.length).toBeGreaterThan(10);
    expect(zonas.every((z) => z.startsWith('America/'))).toBe(true);
    expect(zonas).toContain(ZONA_POR_OMISION);
  });

  test('textosDe ignora archivos', () => {
    const fd = new FormData();
    fd.set('a', 'uno');
    fd.set('f', new Blob(['x']), 'x.txt');
    expect(textosDe(fd)).toEqual({ a: 'uno' });
  });
});
