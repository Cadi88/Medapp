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

// --- API pública de svc-notificaciones (vía gateway `/api/notificaciones`) ---

const fechaLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const horaLocal = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const respuestaPacienteSchema = z.enum(['confirma', 'cancela', 'pide_cambio']);
export type RespuestaPacienteValor = z.infer<typeof respuestaPacienteSchema>;

export const estadoEnvioSchema = z.enum(['pendiente', 'aprobado', 'enviado', 'fallido', 'anulado']);

/** `GET /recordatorios?desde&hasta` y `POST /recordatorios/aprobar`: fechas locales, como máximo 7 días. */
export const rangoRecordatoriosSchema = z.strictObject({ desde: fechaLocal, hasta: fechaLocal });
export type RangoRecordatorios = z.infer<typeof rangoRecordatoriosSchema>;
export const aprobarRangoSchema = rangoRecordatoriosSchema;

export const citaIdParamsSchema = z.object({ citaId: z.uuid() });

/** `POST /recordatorios/:citaId/whatsapp`: `fecha` es la fecha local de la cita que devolvió el listado. */
export const abrirWhatsAppSchema = z.strictObject({ fecha: fechaLocal });
/** `POST /recordatorios/:citaId/respuesta`: la respuesta que el paciente dio por WhatsApp, registrada por recepción. */
export const registrarRespuestaRecepcionSchema = z.strictObject({ fecha: fechaLocal, respuesta: respuestaPacienteSchema });
/** `POST /respuestas/:token`. */
export const registrarRespuestaPacienteSchema = z.strictObject({ respuesta: respuestaPacienteSchema });

export const recordatorioCitaSchema = z.object({
  citaId: z.uuid(),
  fecha: fechaLocal,
  inicio: instante,
  paciente: z.string(),
  medico: z.string(),
  estadoCita: z.enum(['agendada', 'confirmada']),
  pideCambio: z.boolean(),
  correo: z.object({
    estado: z.enum(['sin_correo', 'pendiente', 'aprobado', 'enviado', 'fallido', 'anulado']),
    /** `con_revision`, sin aprobar y ya pasó la hora de envío: "Sin aprobar — no se envió". */
    sinAprobarYVencido: z.boolean(),
    vistaPrevia: z.object({ asunto: z.string(), texto: z.string() }).nullable(),
  }),
  whatsapp: z.object({
    abierto: z.boolean(),
    enlace: z.string().nullable(),
    motivo: z.enum(['telefono_invalido']).nullable(),
    vistaPrevia: z.string(),
  }),
  respuesta: z
    .object({
      valor: respuestaPacienteSchema,
      canal: z.enum(['correo', 'whatsapp_asistido']),
      origen: z.enum(['paciente', 'recepcion']),
      respondidoEn: instante,
    })
    .nullable(),
});
export type RecordatorioCita = z.infer<typeof recordatorioCitaSchema>;

export const plantillasRecordatoriosSchema = z.object({ correoAsunto: z.string(), correoCuerpo: z.string(), whatsapp: z.string() });
export const modoRecordatoriosSchema = z.enum(['con_revision', 'sin_revision']);

export const configRecordatoriosSchema = z.object({ modo: modoRecordatoriosSchema, horaEnvio: horaLocal, plantillas: plantillasRecordatoriosSchema });
export type ConfigRecordatoriosDto = z.infer<typeof configRecordatoriosSchema>;

export const recordatoriosRespuestaSchema = z.object({
  modo: modoRecordatoriosSchema,
  horaEnvio: horaLocal,
  citas: z.array(recordatorioCitaSchema),
});
export type RecordatoriosRespuesta = z.infer<typeof recordatoriosRespuestaSchema>;

/** `PUT /config`: solo lo que cambia; los límites de las plantillas se validan en el servicio. */
export const actualizarConfigRecordatoriosSchema = z.strictObject({
  modo: modoRecordatoriosSchema.optional(),
  horaEnvio: horaLocal.optional(),
  plantillas: z.strictObject({ correoAsunto: z.string().optional(), correoCuerpo: z.string().optional(), whatsapp: z.string().optional() }).optional(),
});
export type ActualizarConfigRecordatorios = z.infer<typeof actualizarConfigRecordatoriosSchema>;

/** Respuesta de `GET /respuestas/:token` (pública): `invalida` no lleva más datos; nunca datos de contacto del paciente. */
export const respuestaPublicaSchema = z.object({
  estado: z.enum(['vigente', 'respondida', 'invalida']),
  consultorio: z.object({ nombre: z.string(), tieneLogo: z.boolean() }).optional(),
  fecha: z.string().optional(),
  hora: z.string().optional(),
  medico: z.string().optional(),
  telefonoConsultorio: z.string().optional(),
});
export type RespuestaPublica = z.infer<typeof respuestaPublicaSchema>;

export const resultadoRespuestaSchema = z.object({ estado: z.enum(['registrada', 'respondida', 'invalida']) });
export type ResultadoRespuesta = z.infer<typeof resultadoRespuestaSchema>;

/** Parámetro de ruta de `/respuestas/:token`: el servicio decide si tiene la forma de un token; basura = enlace inválido, nunca un 400. */
export const tokenParamsSchema = z.object({ token: z.string() });
