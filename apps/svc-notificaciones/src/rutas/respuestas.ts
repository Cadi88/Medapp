import {
  CitaRespuestaPaciente,
  registrarRespuestaPacienteSchema,
  tokenParamsSchema,
  type CitaParaRecordatorio,
  type ConsultorioParaMensaje,
  type RespuestaPublica,
  type ResultadoRespuesta,
} from '@consultorio/contracts';
import { AppError, enqueueEvent, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import { buscarPorHashDeToken, guardarRespuestaDePaciente, leerPorToken, type EnvioConToken } from '../datos/respuestas.js';
import { fechaYHoraLocal } from '../dominio/calendario.js';
import { hashDeToken, tieneFormatoDeToken } from '../dominio/token.js';
import type { ContextoEnvio } from '../envio.js';

/** Rutas públicas (sin JWT): el token del enlace es la credencial. El gateway les aplica el límite por IP. */
export const RUTAS_PUBLICAS = ['/respuestas/*'];

const INVALIDA: RespuestaPublica = { estado: 'invalida' };

/** Estado de un enlace: `invalida` no lleva nada más; `respondida` y `vigente` traen el consultorio (y la cita si vigente). */
type Enlace = { estado: 'invalida' } | { estado: 'respondida'; consultorio: ConsultorioParaMensaje } | { estado: 'vigente'; consultorio: ConsultorioParaMensaje; cita: CitaParaRecordatorio };

export const respuestasRutas: FastifyPluginAsync<{ ctx: ContextoEnvio }> = async (app, { ctx }) => {
  /** Vigente = enviado, sin respuesta y sin vencer (el token vence al inicio de la cita). */
  const vencido = (e: EnvioConToken): boolean => e.venceEn === null || e.venceEn.getTime() <= ctx.reloj().getTime();

  async function evaluar(token: string): Promise<Enlace> {
    if (!tieneFormatoDeToken(token)) return INVALIDA as Enlace;
    const hash = hashDeToken(token);
    const hallado = await buscarPorHashDeToken(ctx.pool, hash);
    if (!hallado) return INVALIDA as Enlace;
    const { tenantId, envioId } = hallado;
    const envio = await withTenant(ctx.pool, tenantId, (tx) => leerPorToken(tx, tenantId, envioId, hash, false));
    if (!envio || envio.estado !== 'enviado') return INVALIDA as Enlace;

    const consultorio = await ctx.puertos.identidad.obtenerConsultorio(tenantId);
    if (envio.respuesta) return { estado: 'respondida', consultorio };
    if (vencido(envio)) return INVALIDA as Enlace;
    const cita = (await ctx.puertos.agenda.obtenerCitas(tenantId, envio.fechaCita, envio.fechaCita)).find((c) => c.citaId === envio.citaId);
    return cita ? { estado: 'vigente', consultorio, cita } : (INVALIDA as Enlace);
  }

  app.get('/respuestas/:token', async (req): Promise<RespuestaPublica> => {
    const enlace = await evaluar(tokenParamsSchema.parse(req.params).token);
    if (enlace.estado === 'invalida') return INVALIDA;
    const { consultorio } = enlace;
    const datos = { consultorio: { nombre: consultorio.nombreMostrado, tieneLogo: consultorio.logoKey !== null }, ...(consultorio.telefono ? { telefonoConsultorio: consultorio.telefono } : {}) };
    if (enlace.estado === 'respondida') return { estado: 'respondida', ...datos };
    const { fecha, hora } = fechaYHoraLocal(enlace.cita.inicio, consultorio.zonaHoraria);
    return { estado: 'vigente', ...datos, fecha, hora, medico: enlace.cita.medicoNombre };
  });

  // Logo del consultorio para la página pública: mismo criterio de validez que la página; todo lo demás es un 404 igual.
  app.get('/respuestas/:token/logo', async (req, reply) => {
    const enlace = await evaluar(tokenParamsSchema.parse(req.params).token);
    const llave = enlace.estado === 'invalida' ? null : enlace.consultorio.logoKey;
    const archivo = llave ? await ctx.puertos.almacen.leer(llave) : null;
    if (!archivo) throw new AppError('NO_ENCONTRADO', 'Recurso no encontrado', 404);
    return reply
      .header('content-type', archivo.tipo)
      .header('cache-control', 'private, max-age=300')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(archivo.bytes));
  });

  app.post('/respuestas/:token', async (req): Promise<ResultadoRespuesta> => {
    const token = tokenParamsSchema.parse(req.params).token;
    const { respuesta } = registrarRespuestaPacienteSchema.parse(req.body);
    if (!tieneFormatoDeToken(token)) return { estado: 'invalida' };
    const hash = hashDeToken(token);
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
