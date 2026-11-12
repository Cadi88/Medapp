import { z } from 'zod';

export const medicoAgendaSchema = z.object({ usuarioId: z.uuid(), nombre: z.string() });
export type MedicoAgenda = z.infer<typeof medicoAgendaSchema>;

const nombreTipo = z.string().trim().min(1).max(80);
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

export const estadoCitaSchema = z.enum(['agendada', 'confirmada', 'atendida', 'cancelada', 'no_asistio']);
export type EstadoCitaDto = z.infer<typeof estadoCitaSchema>;

const contactoNombre = z.string().min(1).max(120);
const contactoTelefono = z.string().regex(/^\+?[0-9 ()-]{8,20}$/);
const contactoEmail = z.email().max(254);
const notas = z.string().max(1000);

export const citaSchema = z.object({
  id: z.uuid(),
  medicoId: z.uuid(),
  tipoCitaId: z.uuid(),
  inicio: instante,
  fin: instante,
  estado: estadoCitaSchema,
  contacto: z.object({ nombre: contactoNombre, telefono: contactoTelefono, email: contactoEmail.optional() }),
  notas: notas.optional(),
  fueraDeHorario: z.boolean(),
  version: z.number().int().min(1),
});
export type Cita = z.infer<typeof citaSchema>;

export const crearCitaSchema = z.strictObject({
  medicoId: z.uuid(),
  tipoCitaId: z.uuid(),
  inicio: instante,
  contacto: z.strictObject({ nombre: contactoNombre, telefono: contactoTelefono, email: contactoEmail.optional() }),
  notas: notas.optional(),
  fueraDeHorario: z.boolean().default(false),
});
export type CrearCita = z.infer<typeof crearCitaSchema>;

export const reprogramarCitaSchema = z.strictObject({
  version: z.number().int().min(1),
  inicio: instante,
  tipoCitaId: z.uuid().optional(),
  medicoId: z.uuid().optional(),
  fueraDeHorario: z.boolean().default(false),
});
export type ReprogramarCita = z.infer<typeof reprogramarCitaSchema>;

export const cambiarEstadoSchema = z.strictObject({ version: z.number().int().min(1), estado: estadoCitaSchema });
export type CambiarEstado = z.infer<typeof cambiarEstadoSchema>;
