import { z } from 'zod';

export const ZONA_POR_OMISION = 'America/Mexico_City';

/** Zonas IANA de América para el registro (la API acepta cualquier zona IANA; la interfaz ofrece estas). */
export function zonasDeAmerica(): string[] {
  return Intl.supportedValuesOf('timeZone').filter((z) => z.startsWith('America/'));
}

const ZONAS = new Set(Intl.supportedValuesOf('timeZone'));

const requerido = (campo: string) => z.string({ error: `${campo} es obligatorio` }).trim().min(1, `${campo} es obligatorio`);
const correo = z
  .string({ error: 'El correo es obligatorio' })
  .trim()
  .min(1, 'El correo es obligatorio')
  .pipe(z.email('Escribe un correo válido'));
const password = z
  .string({ error: 'La contraseña es obligatoria' })
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128, 'La contraseña no puede pasar de 128 caracteres');
/** Código TOTP: 6 dígitos (se ignoran los espacios que los autenticadores muestran entre grupos). */
const totp = z
  .string({ error: 'El código es obligatorio' })
  .transform((c) => c.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos'));

export const loginSchema = z.object({
  email: correo,
  password: z.string({ error: 'La contraseña es obligatoria' }).min(1, 'La contraseña es obligatoria'),
});

export const totpSchema = z.object({ codigo: totp });

export const registroSchema = z.object({
  nombreConsultorio: requerido('El nombre del consultorio').pipe(z.string().min(2, 'Mínimo 2 caracteres').max(120, 'Máximo 120 caracteres')),
  slug: z
    .string({ error: 'El identificador es obligatorio' })
    .regex(/^[a-z0-9-]{3,40}$/, 'Usa de 3 a 40 caracteres: minúsculas, números y guiones'),
  zonaHoraria: z.string({ error: 'Elige una zona horaria' }).refine((z) => ZONAS.has(z), 'Elige una zona horaria válida'),
  esMedico: z.boolean(),
  nombre: requerido('Tu nombre').pipe(z.string().max(120, 'Máximo 120 caracteres')),
  email: correo,
  password,
});

export const cambioPasswordSchema = z
  .object({
    actual: z.string({ error: 'Escribe tu contraseña actual' }).min(1, 'Escribe tu contraseña actual'),
    nueva: password,
    confirmacion: z.string({ error: 'Confirma la contraseña' }),
  })
  .refine((v) => v.nueva === v.confirmacion, { path: ['confirmacion'], message: 'Las contraseñas no coinciden' })
  .refine((v) => v.nueva !== v.actual, { path: ['nueva'], message: 'La contraseña nueva debe ser distinta de la actual' });

export const passwordMfaSchema = z.object({
  password: z.string({ error: 'Escribe tu contraseña' }).min(1, 'Escribe tu contraseña'),
});

export const elegirConsultorioSchema = z.object({ tenantId: z.string({ error: 'Elige un consultorio' }).uuid('Elige un consultorio') });

/** Mensaje por campo (el primero de cada uno); un error sin ruta va bajo la clave `_`. */
export function erroresDeZod(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const campo = i.path.join('.') || '_';
    if (!(campo in out)) out[campo] = i.message;
  }
  return out;
}

/** Valores de un `FormData` como texto (los campos ausentes quedan `undefined`; los archivos se ignoran). */
export function textosDe(fd: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}
