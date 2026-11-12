import { AppError, createHttpApp } from '@consultorio/platform';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Agent, request as undiciRequest } from 'undici';
import { clasificarRuta, filtrarCabecerasPeticion, filtrarCabecerasRespuesta, RUTAS_PUBLICAS, rutaPermitida, urlDestino } from './rutas.js';

export interface GatewayOptions {
  /** JWKS de svc-identidad con el que se verifican los tokens de tenant. */
  jwksUrl: string;
  /** URL base de cada servicio. */
  destinos: { identidad: string; auditoria: string; agenda: string };
  /** Peticiones por minuto y por IP en rutas públicas y de sesión (60). */
  limitePublicoPorMin?: number;
  /**
   * `trustProxy` de Fastify (false). En producción el gateway va detrás de un ALB: sin esto todas las
   * peticiones tendrían la IP del balanceador y el rate limit sería global. Usar la lista de CIDR
   * (separada por comas) de la subred del balanceador; `true` solo si el gateway no es alcanzable sin proxy.
   * No se admite un número de saltos: Fastify 5 lo trata como "no confiar en nadie".
   */
  confiarEnProxy?: boolean | string;
  /** Tiempo máximo hacia el destino (cabeceras y cuerpo), ms (10 000). */
  timeoutDestinoMs?: number;
}

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Ruta interna a la que se reescribe toda petición `/api/` con ruta no permitida (responde 400). */
const RUTA_INVALIDA = '/__ruta_invalida';
const METODOS: Metodo[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Rutas con rate limit por IP (mismas que `REGLAS_ABIERTAS`). */
const RUTAS_LIMITADAS: { metodos: Metodo[]; url: string }[] = [
  { metodos: ['POST'], url: '/api/identidad/registro' },
  { metodos: ['GET', 'POST'], url: '/api/identidad/auth/*' },
  { metodos: ['GET'], url: '/api/identidad/.well-known/jwks.json' },
  { metodos: ['GET'], url: '/api/identidad/tenants/mios' },
  { metodos: ['POST'], url: '/api/identidad/sesion/tenant' },
];

/**
 * Punto de entrada único (BFF). Verifica el JWT de tenant, aplica rate limit por IP a rutas
 * públicas/de sesión y reenvía a identidad/auditoría quitando el prefijo `/api/<servicio>`.
 * Cada servicio vuelve a verificar el token. No hay CORS (no hay cliente web en la fase 0): `OPTIONS`
 * no se proxea y responde 404 uniforme (401 sin token); al añadir el web habrá que tratarlo aquí.
 */
export async function buildGateway(o: GatewayOptions): Promise<FastifyInstance> {
  const timeout = o.timeoutDestinoMs ?? 10_000;
  const app = await createHttpApp({
    servicio: 'gateway',
    plugin: { jwksUrl: o.jwksUrl, rutasPublicas: [...RUTAS_PUBLICAS, RUTA_INVALIDA] },
    fastify: {
      trustProxy: o.confiarEnProxy ?? false,
      // Corre antes de cualquier hook (autenticación incluida): una ruta /api/ con segmentos de punto o
      // barras codificadas nunca llega a clasificarse ni a reenviarse, tenga token o no.
      rewriteUrl: (req) => {
        const url = req.url ?? '';
        return url.startsWith('/api/') && !rutaPermitida(url) ? RUTA_INVALIDA : url;
      },
    },
  });

  // El cuerpo se reenvía tal cual (sin parsear): un único parser binario para cualquier content-type.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  await app.register(rateLimit, {
    global: false,
    max: o.limitePublicoPorMin ?? 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new AppError('PROHIBIDO', 'Demasiadas solicitudes', 429),
  });

  const agente = new Agent({ headersTimeout: timeout, bodyTimeout: timeout, connectTimeout: timeout });
  app.addHook('onClose', async () => {
    await agente.close();
  });

  async function proxear(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const c = clasificarRuta(req.method, req.url);
    if (!c) throw new AppError('NO_ENCONTRADO', 'Recurso no encontrado', 404);
    // El plugin decide "pública" solo por ruta; aquí se exige además el método. Sin tenant → 401.
    if (c.acceso === 'protegida' && !req.ctx.tenantId) throw new AppError('NO_AUTENTICADO', 'No autenticado', 401);

    // Segunda barrera: el destino debe recibir exactamente la ruta clasificada.
    const destino = urlDestino(o.destinos[c.servicio], c.rutaDestino);
    if (!destino) throw new AppError('VALIDACION', 'Solicitud inválida', 400);
    let res;
    try {
      res = await undiciRequest(destino, {
        method: req.method as Metodo,
        headers: filtrarCabecerasPeticion(req.headers, { traceId: req.ctx.traceId, ip: req.ip, protocolo: req.protocol, servicio: c.servicio }),
        body: Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined,
        dispatcher: agente,
      });
    } catch (err) {
      req.log.warn({ err, servicio: c.servicio }, 'destino no disponible');
      throw new AppError('INTERNO', 'Servicio no disponible', 503);
    }
    // x-trace-id de la respuesta ya lo fijó el plugin; las cabeceras del destino se suman.
    void reply.code(res.statusCode).headers(filtrarCabecerasRespuesta(res.headers));
    return reply.send(res.body);
  }

  app.route({
    method: METODOS,
    url: RUTA_INVALIDA,
    handler: () => {
      throw new AppError('VALIDACION', 'Solicitud inválida', 400);
    },
  });
  for (const r of RUTAS_LIMITADAS) {
    app.route({ method: r.metodos, url: r.url, config: { rateLimit: {} }, handler: proxear });
  }
  for (const s of ['identidad', 'auditoria', 'agenda']) {
    app.route({ method: METODOS, url: `/api/${s}/*`, handler: proxear });
  }
  return app;
}
