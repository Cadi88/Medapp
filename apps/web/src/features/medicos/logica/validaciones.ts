import { z } from 'zod';

const MENSAJE_DURACION = 'La duración debe ser de 5 a 480 minutos';

export const tipoCitaFormSchema = z.object({
  nombre: z.string({ error: 'El nombre es obligatorio' }).trim().min(1, 'El nombre es obligatorio').max(80, 'Máximo 80 caracteres'),
  duracionMin: z
    .string({ error: MENSAJE_DURACION })
    .trim()
    .regex(/^\d+$/, MENSAJE_DURACION)
    .transform(Number)
    .pipe(z.number().min(5, MENSAJE_DURACION).max(480, MENSAJE_DURACION)),
});

/** Fechas tal como las entrega `datetime-local` (hora del consultorio, sin desfase). */
export const altaBloqueoSchema = z
  .object({
    inicio: z.string({ error: 'Elige el inicio' }).min(1, 'Elige el inicio'),
    fin: z.string({ error: 'Elige el fin' }).min(1, 'Elige el fin'),
    motivo: z
      .string()
      .trim()
      .max(200, 'Máximo 200 caracteres')
      .optional()
      .transform((m) => m || undefined),
  })
  .refine((v) => v.inicio < v.fin, { path: ['fin'], message: 'El inicio debe ser anterior al fin' });

export const medicoIdSchema = z.uuid();
export const idsTipoSchema = z.object({ medicoId: z.uuid(), tipoId: z.uuid() });
export const idsBloqueoSchema = z.object({ medicoId: z.uuid(), bloqueoId: z.uuid() });

export const DATOS_INVALIDOS = 'Revisa los datos del formulario';
