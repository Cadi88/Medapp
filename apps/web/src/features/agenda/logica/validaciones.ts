import { z } from 'zod';

/** Alta de cita desde el formulario (textos libres en español). El API revalida con `crearCitaSchema`. */
export const altaCitaSchema = z.object({
  medicoId: z.uuid(),
  tipoCitaId: z.uuid(),
  inicio: z.iso.datetime({ offset: true }),
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120, 'Máximo 120 caracteres'),
  telefono: z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/, 'Escribe un teléfono válido'),
  email: z
    .string()
    .trim()
    .max(254, 'Máximo 254 caracteres')
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Escribe un correo válido'),
  notas: z.string().trim().max(1000, 'Máximo 1000 caracteres'),
  fueraDeHorario: z.boolean().default(false),
});
export type AltaCita = z.input<typeof altaCitaSchema>;

export const idCitaSchema = z.uuid();

export const consultaCitasSchema = z.object({
  desde: z.iso.datetime({ offset: true }),
  hasta: z.iso.datetime({ offset: true }),
  medicoId: z.uuid().optional(),
});

export const consultaHuecosSchema = z.object({
  medicoId: z.uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipoCitaId: z.uuid(),
});
