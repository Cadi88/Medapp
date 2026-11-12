import { rolSchema } from '@consultorio/contracts';
import { z } from 'zod';

export const uuidSchema = z.string().uuid();

/** RFC de persona física (13) o moral (12), en mayúsculas. */
export const rfcSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/));

export const datosFiscalesSchema = z.strictObject({
  rfc: rfcSchema,
  razonSocial: z.string().trim().min(1).max(300),
  regimenFiscal: z.string().regex(/^\d{3}$/),
  cp: z.string().regex(/^\d{5}$/),
});
export type DatosFiscales = z.infer<typeof datosFiscalesSchema>;

export const perfilSchema = z.strictObject({
  cedulaProfesional: z.string().regex(/^\d{7,8}$/),
  especialidad: z.string().trim().min(1).max(200).optional(),
  cedulaEspecialidad: z.string().trim().min(1).max(50).optional(),
  institucion: z.string().trim().min(1).max(200).optional(),
});
export type PerfilMedico = z.infer<typeof perfilSchema>;

export const miembroSchema = z.strictObject({
  email: z.email().transform((e) => e.toLowerCase()),
  nombre: z.string().trim().min(1).max(120),
  rol: rolSchema,
  admin: z.boolean(),
  passwordTemporal: z.string().min(10).max(128),
});
export type MiembroInput = z.infer<typeof miembroSchema>;

export const tenantBodySchema = z.strictObject({ tenantId: uuidSchema });

export const passwordTemporalSchema = z.strictObject({ passwordTemporal: z.string().min(10).max(128) });
