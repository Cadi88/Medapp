import { z } from 'zod';

export const medicoAgendaSchema = z.object({ usuarioId: z.uuid(), nombre: z.string() });
export type MedicoAgenda = z.infer<typeof medicoAgendaSchema>;

const nombreTipo = z.string().min(1).max(80);
const duracion = z.number().int().min(5).max(480);

export const tipoCitaSchema = z.object({
  id: z.uuid(),
  medicoId: z.uuid(),
  nombre: nombreTipo,
  duracionMin: duracion,
  activo: z.boolean(),
});
export type TipoCita = z.infer<typeof tipoCitaSchema>;

export const crearTipoCitaSchema = z.strictObject({ nombre: nombreTipo, duracionMin: duracion });
export type CrearTipoCita = z.infer<typeof crearTipoCitaSchema>;

export const editarTipoCitaSchema = z.strictObject({
  nombre: nombreTipo.optional(),
  duracionMin: duracion.optional(),
  activo: z.boolean().optional(),
});
export type EditarTipoCita = z.infer<typeof editarTipoCitaSchema>;

const hora = z.string().regex(/^\d{2}:\d{2}$/);

export const bloqueHorarioSchema = z.object({
  diaSemana: z.number().int().min(0).max(6),
  horaInicio: hora,
  horaFin: hora,
});
export type BloqueHorarioDto = z.infer<typeof bloqueHorarioSchema>;

export const semanaSchema = z.object({ bloques: z.array(bloqueHorarioSchema).max(28) });
export type Semana = z.infer<typeof semanaSchema>;

const instante = z.iso.datetime({ offset: true });

export const bloqueoSchema = z.object({
  id: z.uuid(),
  medicoId: z.uuid(),
  inicio: instante,
  fin: instante,
  motivo: z.string().nullable(),
});
export type Bloqueo = z.infer<typeof bloqueoSchema>;

export const crearBloqueoSchema = z
  .strictObject({ inicio: instante, fin: instante, motivo: z.string().max(200).optional() })
  .refine((v) => new Date(v.inicio).getTime() < new Date(v.fin).getTime(), { message: 'El inicio debe ser anterior al fin', path: ['fin'] });
export type CrearBloqueo = z.infer<typeof crearBloqueoSchema>;

export const disponibilidadSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipoCitaId: z.uuid(),
  huecos: z.array(z.string()),
});
export type Disponibilidad = z.infer<typeof disponibilidadSchema>;
