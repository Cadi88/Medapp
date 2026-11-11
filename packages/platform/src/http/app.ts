import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from 'fastify';
import { createLogger } from '../observability.js';
import { mapError } from './errors.js';
import { platformPlugin, RUTA_SALUD, type PlatformPluginOptions } from './plugin.js';
import { sanitizeTraceId } from './public-routes.js';

export interface HttpAppOptions {
  servicio: string;
  plugin: Omit<PlatformPluginOptions, 'servicio'>;
  fastify?: Omit<FastifyServerOptions, 'logger' | 'loggerInstance'>;
}

/**
 * Única forma soportada de construir la app HTTP de un servicio/gateway: crea Fastify con el
 * logger estructurado, registra `platformPlugin` PRIMERO (así sus handlers de error y 404 alcanzan
 * todas las rutas/plugins posteriores) y responde con el formato único también ante errores de
 * framework (p. ej. URL malformada), incluyendo `x-trace-id`.
 */
export async function createHttpApp(o: HttpAppOptions): Promise<FastifyInstance> {
  const opts: FastifyServerOptions = {
    ...o.fastify,
    loggerInstance: createLogger(o.servicio),
    frameworkErrors: (err, req, res) => {
      const reply = res as unknown as FastifyReply;
      const m = mapError(err);
      // Un error de framework sin clasificar es, en la práctica, una petición inválida (nunca 500 con detalle).
      const [status, body] = m.unexpected
        ? [400, { code: 'VALIDACION', message: 'Solicitud inválida' }]
        : [m.status, m.body];
      void reply
        .header('x-trace-id', sanitizeTraceId(req.headers['x-trace-id']))
        .code(status)
        .send(body);
    },
  };
  const app = Fastify(opts) as unknown as FastifyInstance;
  await app.register(platformPlugin, { servicio: o.servicio, ...o.plugin });
  app.get(RUTA_SALUD, () => ({ ok: true }));
  return app;
}
