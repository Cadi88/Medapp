import { z } from 'zod';

const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .transform((t) => t || undefined);

/** Mismas reglas que `PUT /medicos/:id/perfil`. Los campos opcionales vacíos no se envían. */
export const perfilMedicoSchema = z.object({
  cedulaProfesional: z
    .string({ error: 'La cédula profesional debe tener 7 u 8 dígitos' })
    .trim()
    .regex(/^\d{7,8}$/, 'La cédula profesional debe tener 7 u 8 dígitos'),
  especialidad: opcional(200),
  cedulaEspecialidad: opcional(50),
  institucion: opcional(200),
});
