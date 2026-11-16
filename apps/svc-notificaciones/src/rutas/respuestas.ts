import {
  CitaRespuestaPaciente,
  registrarRespuestaPacienteSchema,
  tokenParamsSchema,
  type RespuestaPublica,
  type ResultadoRespuesta,
} from '@consultorio/contracts';
import { enqueueEvent, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import { buscarPorHashDeToken, guardarRespuestaDePaciente, leerPorToken, type EnvioConToken } from '../datos/respuestas.js';
import { fechaYHoraLocal } from '../dominio/calendario.js';
import { hashDeToken } from '../dominio/token.js';
import type { ContextoEnvio } from '../envio.js';

/** Rutas públicas (sin JWT): el token del enlace es la credencial. El gateway les aplica el límite por IP. */
export const RUTAS_PUBLICAS = ['/respuestas/*'];

const INVALIDA: RespuestaPublica = { estado: 'invalida' };

export const respuestasRutas: FastifyPluginAsync<{ ctx: ContextoEnvio }> = async (app, { ctx }) => {
  /** Vigente = enviado, sin respuesta y sin vencer (el token vence al inicio de la cita). */
  const vencido = (e: EnvioConToken): boolean => e.venceEn === null || e.venceEn.getTime() <= ctx.reloj().getTime();

  app.get('/respuestas/:token', async (req): Promise<RespuestaPublica> => {
    const hash = hashDeToken(tokenParamsSchema.parse(req.params).token);
    const hallado = await buscarPorHashDeToken(ctx.pool, hash);
    if (!hallado) return INVALIDA;
    const { tenantId, envioId } = hallado;
    const envio = await withTenant(ctx.pool, tenantId, (tx) => leerPorToken(tx, tenantId, envioId, hash, false));
    if (!envio || envio.estado !== 'enviado') return INVALIDA;

    const consultorio = await ctx.puertos.identidad.obtenerConsultorio(tenantId);
    const datosConsultorio = { consultorio: { nombre: consultorio.nombreMostrado, tieneLogo: consultorio.logoKey !== null }, ...(consultorio.telefono ? { telefonoConsultorio: consultorio.telefono } : {}) };
    if (envio.respuesta) return { estado: 'respondida', ...datosConsultorio };
    if (vencido(envio)) return INVALIDA;

    const cita = (await ctx.puertos.agenda.obtenerCitas(tenantId, envio.fechaCita, envio.fechaCita)).find((c) => c.citaId === envio.citaId);
    if (!cita) return INVALIDA;
    const { fecha, hora } = fechaYHoraLocal(cita.inicio, consultorio.zonaHoraria);
    return { estado: 'vigente', ...datosConsultorio, fecha, hora, medico: cita.medicoNombre };
  });

  app.post('/respuestas/:token', async (req): Promise<ResultadoRespuesta> => {
    const hash = hashDeToken(tokenParamsSchema.parse(req.params).token);
    const { respuesta } = registrarRespuestaPacienteSchema.parse(req.body);
    const hallado = await buscarPorHashDeToken(ctx.pool, hash);
    if (!hallado) return { estado: 'invalida' };
    const { tenantId, envioId } = hallado;
    const { traceId } = req.ctx;
    const estado = await withTenant(ctx.pool, tenantId, async (tx): Promise<ResultadoRespuesta['estado']> => {
      // FOR UPDATE: dos respuestas simultáneas se serializan; la segunda ya ve la respuesta de la primera.
      const envio = await leerPorToken(tx, tenantId, envioId, hash, true);
      if (!envio || envio.estado !== 'enviado') return 'invalida';
      if (envio.respuesta) return 'respondida';
      if (vencido(envio) || envio.venceEn === null) return 'invalida';
      await guardarRespuestaDePaciente(tx, envio.id, respuesta, ctx.reloj());
      await enqueueEvent(
        tx,
        CitaRespuestaPaciente.create({ tenantId, actorId: null, traceId, data: { citaId: envio.citaId, inicioCita: envio.venceEn.toISOString(), respuesta, canal: envio.canal, origen: 'paciente' } }),
      );
      return 'registrada';
    });
    return { estado };
  });
};
