import {
  abrirWhatsAppSchema,
  aprobarRangoSchema,
  CitaRespuestaPaciente,
  citaIdParamsSchema,
  rangoRecordatoriosSchema,
  registrarRespuestaRecepcionSchema,
  type CitaParaRecordatorio,
  type RecordatoriosRespuesta,
} from '@consultorio/contracts';
import { AppError, enqueueEvent, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import { DateTime } from 'luxon';
import { uuidv7 } from 'uuidv7';
import { leerConfig } from '../datos/config.js';
import { leerZonaHoraria } from '../datos/consultorios.js';
import {
  aprobarEnvio,
  aprobarPendientes,
  envioCorreoVigenteDeCita,
  listarEnviosDeRango,
  reabrirFallido,
  registrarRespuestaDeRecepcion,
  registrarWhatsAppAbierto,
  type Envio,
  type EnvioDetalle,
} from '../datos/envios.js';
import { enviableAhora, errorDeRango, fechaCitaLocal, recortarHora, type EstadoEnvio } from '../dominio/calendario.js';
import { armarRecordatorio, armarWhatsApp } from '../dominio/recordatorios.js';
import { asegurarEnvios, enviarCorreo, type ContextoEnvio, type ResultadoEnvio } from '../envio.js';
import { exigirPersonal } from './acceso.js';

/** Días (inclusive) que abarca como máximo la pantalla; agenda admite 8. */
export const MAX_DIAS_PANTALLA = 7;

function exigirRango(desde: string, hasta: string): void {
  const error = errorDeRango(desde, hasta, MAX_DIAS_PANTALLA);
  if (error) throw new AppError('VALIDACION', error, 400, [{ campo: 'hasta' }]);
}

/** La cita (agendada o confirmada) de esa fecha local según agenda; 404 si ya no está. */
async function citaDeLaFecha(ctx: ContextoEnvio, tenantId: string, citaId: string, fecha: string): Promise<CitaParaRecordatorio> {
  const cita = (await ctx.puertos.agenda.obtenerCitas(tenantId, fecha, fecha)).find((c) => c.citaId === citaId);
  if (!cita) throw new AppError('NO_ENCONTRADO', 'Cita no encontrada', 404);
  return cita;
}

/** Envía y nunca lanza: la aprobación ya quedó guardada y volver a aprobar (o Reintentar) lo intenta de nuevo. */
async function intentarEnvio(ctx: ContextoEnvio, tenantId: string, usuarioId: string, envioId: string): Promise<ResultadoEnvio | null> {
  try {
    return await enviarCorreo(ctx, tenantId, envioId, usuarioId);
  } catch (err) {
    ctx.logger?.error({ err, envioId }, 'no se pudo enviar el correo aprobado');
    return null;
  }
}

/** Envía en ese momento un correo aprobado si ya pasó su hora de envío y la cita aún no empieza; si no, lo enviará la corrida del día. */
async function enviarSiCorresponde(ctx: ContextoEnvio, tenantId: string, usuarioId: string, envio: Envio): Promise<ResultadoEnvio | null> {
  try {
    const { zona, config } = await withTenant(ctx.pool, tenantId, async (tx) => ({ zona: await leerZonaHoraria(tx, tenantId), config: await leerConfig(tx, tenantId) }));
    const cita = (await ctx.puertos.agenda.obtenerCitas(tenantId, envio.fechaCita, envio.fechaCita)).find((c) => c.citaId === envio.citaId);
    if (!zona || !cita || !enviableAhora(DateTime.fromJSDate(ctx.reloj()), zona, config.horaEnvio, envio.fechaCita, cita.inicio)) return null;
  } catch (err) {
    ctx.logger?.error({ err, envioId: envio.id }, 'no se pudo decidir el envío inmediato');
    return null;
  }
  return intentarEnvio(ctx, tenantId, usuarioId, envio.id);
}

const estadoTrasEnvio = (r: ResultadoEnvio | null): EstadoEnvio => r?.estado ?? 'aprobado';

export const recordatoriosRutas: FastifyPluginAsync<{ ctx: ContextoEnvio }> = async (app, { ctx }) => {
  const pool = ctx.pool;
  const ahora = (): DateTime => DateTime.fromJSDate(ctx.reloj());

  app.get('/recordatorios', { preHandler: exigirPersonal }, async (req): Promise<RecordatoriosRespuesta> => {
    const { desde, hasta } = rangoRecordatoriosSchema.parse(req.query);
    exigirRango(desde, hasta);
    const { tenantId } = req.ctx;
    await asegurarEnvios(ctx, tenantId, desde, hasta);
    const [citas, consultorio, { config, envios }] = await Promise.all([
      ctx.puertos.agenda.obtenerCitas(tenantId, desde, hasta),
      ctx.puertos.identidad.obtenerConsultorio(tenantId),
      withTenant(pool, tenantId, async (tx) => ({ config: await leerConfig(tx, tenantId), envios: await listarEnviosDeRango(tx, tenantId, desde, hasta) })),
    ]);
    const porCita = new Map<string, EnvioDetalle[]>();
    for (const e of envios) porCita.set(`${e.citaId}|${e.fechaCita}`, [...(porCita.get(`${e.citaId}|${e.fechaCita}`) ?? []), e]);
    const ahoraLocal = ahora();
    return {
      modo: config.modo,
      horaEnvio: recortarHora(config.horaEnvio),
      citas: citas.map((cita) =>
        armarRecordatorio({ cita, consultorio, config, envios: porCita.get(`${cita.citaId}|${fechaCitaLocal(cita.inicio, consultorio.zonaHoraria)}`) ?? [], ahora: ahoraLocal }),
      ),
    };
  });

  app.post('/recordatorios/aprobar', { preHandler: exigirPersonal }, async (req) => {
    const { desde, hasta } = aprobarRangoSchema.parse(req.body);
    exigirRango(desde, hasta);
    const { tenantId, usuarioId } = req.ctx;
    await asegurarEnvios(ctx, tenantId, desde, hasta);
    const aprobados = await withTenant(pool, tenantId, (tx) => aprobarPendientes(tx, tenantId, desde, hasta, usuarioId, ctx.reloj()));
    let enviados = 0;
    for (const envio of aprobados) {
      if ((await enviarSiCorresponde(ctx, tenantId, usuarioId, envio))?.resultado === 'enviado') enviados += 1;
    }
    return { aprobados: aprobados.length, enviados };
  });

  app.post('/recordatorios/:citaId/aprobar', { preHandler: exigirPersonal }, async (req) => {
    const { citaId } = citaIdParamsSchema.parse(req.params);
    const { tenantId, usuarioId } = req.ctx;
    const envio = await withTenant(pool, tenantId, (tx) => envioCorreoVigenteDeCita(tx, tenantId, citaId));
    if (!envio) throw new AppError('NO_ENCONTRADO', 'Recordatorio no encontrado', 404);
    const recienAprobado = await withTenant(pool, tenantId, (tx) => aprobarEnvio(tx, tenantId, envio.id, usuarioId, ctx.reloj()));
    const estado: EstadoEnvio = recienAprobado ? 'aprobado' : envio.estado;
    // Un correo ya aprobado que no salió (agenda caída) se reintenta al volver a aprobar; el resto no tiene nada que enviar.
    if (estado !== 'aprobado') return { citaId, estado };
    return { citaId, estado: estadoTrasEnvio(await enviarSiCorresponde(ctx, tenantId, usuarioId, envio)) };
  });

  app.post('/recordatorios/:citaId/reintentar', { preHandler: exigirPersonal }, async (req) => {
    const { citaId } = citaIdParamsSchema.parse(req.params);
    const { tenantId, usuarioId } = req.ctx;
    const envio = await withTenant(pool, tenantId, (tx) => envioCorreoVigenteDeCita(tx, tenantId, citaId));
    if (!envio) throw new AppError('NO_ENCONTRADO', 'Recordatorio no encontrado', 404);
    const reabierto = await withTenant(pool, tenantId, (tx) => reabrirFallido(tx, tenantId, envio.id, usuarioId, ctx.reloj()));
    if (!reabierto) throw new AppError('CONFLICTO', 'Solo se puede reintentar un correo que no se pudo enviar', 409);
    return { citaId, estado: estadoTrasEnvio(await intentarEnvio(ctx, tenantId, usuarioId, envio.id)) };
  });

  app.post('/recordatorios/:citaId/whatsapp', { preHandler: exigirPersonal }, async (req) => {
    const { citaId } = citaIdParamsSchema.parse(req.params);
    const { fecha } = abrirWhatsAppSchema.parse(req.body);
    const { tenantId, usuarioId } = req.ctx;
    const cita = await citaDeLaFecha(ctx, tenantId, citaId, fecha);
    const [consultorio, config] = await Promise.all([
      ctx.puertos.identidad.obtenerConsultorio(tenantId),
      withTenant(pool, tenantId, (tx) => leerConfig(tx, tenantId)),
    ]);
    const { enlace } = armarWhatsApp(cita, consultorio, config.plantillas.whatsapp);
    if (enlace === null) throw new AppError('VALIDACION', 'Teléfono no válido para WhatsApp', 400, [{ campo: 'telefono' }]);
    await withTenant(pool, tenantId, (tx) => registrarWhatsAppAbierto(tx, uuidv7(), tenantId, citaId, fecha, usuarioId, ctx.reloj()));
    return { enlace };
  });

  app.post('/recordatorios/:citaId/respuesta', { preHandler: exigirPersonal }, async (req) => {
    const { citaId } = citaIdParamsSchema.parse(req.params);
    const { fecha, respuesta } = registrarRespuestaRecepcionSchema.parse(req.body);
    const { tenantId, usuarioId, traceId } = req.ctx;
    const cita = await citaDeLaFecha(ctx, tenantId, citaId, fecha);
    await withTenant(pool, tenantId, async (tx) => {
      await registrarRespuestaDeRecepcion(tx, uuidv7(), tenantId, citaId, fecha, usuarioId, respuesta, ctx.reloj());
      await enqueueEvent(
        tx,
        CitaRespuestaPaciente.create({ tenantId, actorId: usuarioId, traceId, data: { citaId, inicioCita: cita.inicio, respuesta, canal: 'whatsapp_asistido', origen: 'recepcion' } }),
      );
    });
    return { citaId, respuesta };
  });
};
