import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Auth } from '../auth.js';

export interface AuthRoutesOptions {
  auth: Pick<Auth, 'handler'>;
}

// Cabeceras que no deben cruzar el puente: el cuerpo se reserializa y la respuesta de fetch ya viene decodificada.
const OMITIR_PETICION = new Set(['content-length', 'transfer-encoding', 'connection']);
const OMITIR_RESPUESTA = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'set-cookie']);

function aWebRequest(req: FastifyRequest): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || OMITIR_PETICION.has(k)) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const url = new URL(req.url, `${req.protocol}://${req.headers.host ?? 'localhost'}`);
  const body = req.method === 'GET' || req.body === undefined ? undefined : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  return new Request(url, { method: req.method, headers, ...(body === undefined ? {} : { body }) });
}

/**
 * Puente Fastify → `auth.handler` (API web estándar de Better Auth) bajo `/auth/*`.
 * Se eligió esto sobre `toNodeHandler` porque Fastify ya consumió el cuerpo de la petición
 * (toNodeHandler necesita el stream crudo) y así los errores pasan por el manejador de la plataforma.
 */
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { auth }) => {
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    handler: async (req, reply) => {
      const res = await auth.handler(aWebRequest(req));
      reply.code(res.status);
      res.headers.forEach((valor, nombre) => {
        if (!OMITIR_RESPUESTA.has(nombre)) void reply.header(nombre, valor);
      });
      const cookies = res.headers.getSetCookie();
      if (cookies.length > 0) void reply.header('set-cookie', cookies);
      return reply.send(res.body ? await res.text() : undefined);
    },
  });
};
