import { z } from 'zod';
import { defineEvent } from '../envelope.js';

// Ningún evento de notificaciones lleva teléfono ni correo del paciente.
export const CitaRespuestaPaciente = defineEvent(
  'cita.respuesta_paciente',
  1,
  z.object({
    citaId: z.uuid(),
    inicioCita: z.iso.datetime({ offset: true }),
    respuesta: z.enum(['confirma', 'cancela', 'pide_cambio']),
    canal: z.enum(['correo', 'whatsapp_asistido']),
    origen: z.enum(['paciente', 'recepcion']),
  }),
);

export const ConfigRecordatoriosActualizada = defineEvent(
  'config_recordatorios.actualizada',
  1,
  z.object({ campos: z.array(z.string()) }),
);
