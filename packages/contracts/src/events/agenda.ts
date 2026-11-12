import { z } from 'zod';
import { estadoCitaSchema } from '../api/agenda.js';
import { defineEvent } from '../envelope.js';

// Contrato v1 de la spec §3.5. Ningún evento de agenda lleva datos de contacto del paciente (nombre, teléfono, email).
const instante = z.iso.datetime({ offset: true });

/** Canal por el que se creó la cita: en esta entrega solo `recepcion` (la entrega 2 agrega `reserva_publica`). */
export const origenCitaSchema = z.enum(['recepcion']);

export const CitaCreada = defineEvent(
  'cita.creada',
  1,
  z.object({
    citaId: z.uuid(),
    medicoId: z.uuid(),
    tipoCitaId: z.uuid(),
    inicio: instante,
    fin: instante,
    estado: estadoCitaSchema,
    origen: origenCitaSchema,
    fueraDeHorario: z.boolean(),
  }),
);

export const CitaReprogramada = defineEvent(
  'cita.reprogramada',
  1,
  z.object({
    citaId: z.uuid(),
    medicoId: z.uuid(),
    inicio: instante,
    fin: instante,
    anterior: z.object({ medicoId: z.uuid(), inicio: instante, fin: instante }),
  }),
);

export const CitaCancelada = defineEvent(
  'cita.cancelada',
  1,
  z.object({ citaId: z.uuid(), medicoId: z.uuid(), inicio: instante, fin: instante }),
);

/** `de` → `a` para confirmada, atendida y no_asistio (la cancelación tiene su propio evento). `medicoId` es un dato adicional. */
export const CitaEstadoCambiado = defineEvent(
  'cita.estado_cambiado',
  1,
  z.object({ citaId: z.uuid(), medicoId: z.uuid(), de: estadoCitaSchema, a: estadoCitaSchema }),
);
