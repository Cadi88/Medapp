import { z } from 'zod';
import { rolSchema } from '../auth.js';

export const consultorioSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string(),
  slug: z.string(),
  zonaHoraria: z.string(),
});
export type Consultorio = z.infer<typeof consultorioSchema>;

export const perfilMedicoSchema = z.object({
  cedulaProfesional: z.string().nullable(),
  especialidad: z.string().nullable(),
  cedulaEspecialidad: z.string().nullable(),
  institucion: z.string().nullable(),
});
export type PerfilMedicoVista = z.infer<typeof perfilMedicoSchema>;

export const miembroSchema = z.object({
  usuarioId: z.string().uuid(),
  nombre: z.string(),
  email: z.string(),
  rol: rolSchema,
  admin: z.boolean(),
  mfaActivo: z.boolean(),
  debeCambiarPassword: z.boolean(),
  perfilMedico: perfilMedicoSchema.nullable(),
});
export type Miembro = z.infer<typeof miembroSchema>;

export const miembrosRespuestaSchema = z.object({ miembros: z.array(miembroSchema) });
export type MiembrosRespuesta = z.infer<typeof miembrosRespuestaSchema>;

/** Cuerpo de PATCH /miembros/:usuarioId: al menos un campo. */
export const editarMiembroSchema = z
  .strictObject({ rol: rolSchema.optional(), admin: z.boolean().optional() })
  .refine((v) => v.rol !== undefined || v.admin !== undefined, { message: 'Se requiere rol o admin' });
export type EditarMiembro = z.infer<typeof editarMiembroSchema>;
