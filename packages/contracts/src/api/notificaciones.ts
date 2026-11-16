import { z } from 'zod';
import { codigoPaisSchema } from '../paises/tipos.js';

const instante = z.iso.datetime({ offset: true });

/** Respuesta de `GET /interno/citas-para-recordatorio` de svc-agenda (solo citas agendadas o confirmadas). */
export const citaParaRecordatorioSchema = z.object({
  citaId: z.uuid(),
  version: z.number().int().min(1),
  inicio: instante,
  fin: instante,
  estado: z.enum(['agendada', 'confirmada']),
  pideCambio: z.boolean(),
  medicoId: z.uuid(),
  medicoNombre: z.string(),
  tipoCitaNombre: z.string(),
  contacto: z.object({ nombre: z.string(), telefono: z.string(), email: z.string().nullable() }),
});
export type CitaParaRecordatorio = z.infer<typeof citaParaRecordatorioSchema>;

export const citasParaRecordatorioRespuestaSchema = z.object({ citas: z.array(citaParaRecordatorioSchema) });

/** Respuesta de `GET /interno/consultorio-para-mensaje` de svc-identidad. */
export const consultorioParaMensajeSchema = z.object({
  nombreMostrado: z.string(),
  telefono: z.string().nullable(),
  colorPrimario: z.string().nullable(),
  colorTexto: z.string().nullable(),
  logoKey: z.string().nullable(),
  zonaHoraria: z.string(),
  pais: codigoPaisSchema,
});
export type ConsultorioParaMensaje = z.infer<typeof consultorioParaMensajeSchema>;
