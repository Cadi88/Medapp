import { z } from 'zod';
import { defineEvent } from '../envelope.js';

// Ningún evento de agenda lleva datos de contacto del paciente (nombre, teléfono, email).
const instante = z.string().datetime({ offset: true });
const estado = z.enum(['agendada', 'confirmada', 'atendida', 'cancelada', 'no_asistio']);

export const CitaCreada = defineEvent(
  'cita.creada',
  1,
  z.object({
    citaId: z.string().uuid(),
    medicoId: z.string().uuid(),
    tipoCitaId: z.string().uuid(),
    inicio: instante,
    fin: instante,
    fueraDeHorario: z.boolean(),
  }),
);

export const CitaReprogramada = defineEvent(
  'cita.reprogramada',
  1,
  z.object({
    citaId: z.string().uuid(),
    medicoId: z.string().uuid(),
    medicoAnteriorId: z.string().uuid(),
    tipoCitaId: z.string().uuid(),
    inicio: instante,
    fin: instante,
    inicioAnterior: instante,
    finAnterior: instante,
    fueraDeHorario: z.boolean(),
  }),
);

export const CitaCancelada = defineEvent(
  'cita.cancelada',
  1,
  z.object({ citaId: z.string().uuid(), medicoId: z.string().uuid(), inicio: instante, fin: instante }),
);

export const CitaEstadoCambiado = defineEvent(
  'cita.estado_cambiado',
  1,
  z.object({ citaId: z.string().uuid(), medicoId: z.string().uuid(), estadoAnterior: estado, estado }),
);
