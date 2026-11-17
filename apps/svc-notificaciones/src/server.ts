import { createHttpApp } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Logger } from 'pino';
import type { ContextoEnvio } from './envio.js';
import type { Puertos } from './puertos.js';
import { configRutas } from './rutas/config.js';
import { recordatoriosRutas } from './rutas/recordatorios.js';
import { respuestasRutas, RUTAS_PUBLICAS } from './rutas/respuestas.js';

export interface ServerOptions {
  /** Pool del rol `notificaciones_app`. */
  pool: pg.Pool;
  /** JWKS de svc-identidad con el que se verifican los tokens de tenant. */
  jwksUrl: string;
  /** Reloj inyectable: el dominio nunca llama a `new Date()`. */
  reloj?: () => Date;
  /** Origen público del sitio web (enlaces de los correos). */
  webOrigen: string;
  /** Agenda, identidad, correo y almacén; las rutas y el programador los usan. */
  puertos: Puertos;
  /** Solo se registran identificadores: nunca correos, teléfonos ni nombres. */
  logger?: Logger;
}

export async function buildServer(o: ServerOptions): Promise<FastifyInstance> {
  // Las rutas de respuesta del paciente son públicas (el token del enlace es la credencial); el resto exige JWT.
  const app = await createHttpApp({
    servicio: 'svc-notificaciones',
    plugin: { jwksUrl: o.jwksUrl, rutasPublicas: RUTAS_PUBLICAS },
    // Un token de enlace con basura (muy largo) debe llegar al handler y responder "inválido", no un 404 del enrutador.
    fastify: { routerOptions: { maxParamLength: 2048 } },
  });
  const ctx: ContextoEnvio = { pool: o.pool, puertos: o.puertos, reloj: o.reloj ?? (() => new Date()), webOrigen: o.webOrigen, ...(o.logger ? { logger: o.logger } : {}) };
  await app.register(recordatoriosRutas, { ctx });
  await app.register(configRutas, { ctx });
  await app.register(respuestasRutas, { ctx });
  return app;
}
