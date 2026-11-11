import { tokenClaimsSchema, type Rol } from '@consultorio/contracts';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError, mapError } from './errors.js';
import { isPublicPath, sanitizeTraceId } from './public-routes.js';

/** En rutas públicas solo `traceId` está presente en tiempo de ejecución. */
export interface RequestCtx {
  tenantId: string;
  usuarioId: string;
  rol: Rol;
  mfa: boolean;
  traceId: string;
}

export interface PlatformPluginOptions {
  servicio: string;
  jwksUrl?: string;
  /** Tiene prioridad sobre `jwksUrl` (p. ej. `createLocalJWKSet` en identidad). */
  verificador?: JWTVerifyGetKey;
  /** Coincidencia exacta con la ruta sin query, o por prefijo si termina en `/*`. */
  rutasPublicas?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestCtx;
  }
}

/** Ruta pública de salud que `createHttpApp` registra en todo servicio. */
export const RUTA_SALUD = '/salud';

const BEARER_RE = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i;
const noAutenticado = (): AppError => new AppError('NO_AUTENTICADO', 'No autenticado', 401);

async function autenticar(request: FastifyRequest, key: JWTVerifyGetKey): Promise<Omit<RequestCtx, 'traceId'>> {
  const m = BEARER_RE.exec(request.headers.authorization ?? '');
  if (!m?.[1]) throw noAutenticado();
  try {
    // exp obligatorio y vida máxima de 15 min desde iat (también obligatorio con maxTokenAge), aunque exp diga más.
    const { payload } = await jwtVerify(m[1], key, {
      issuer: 'svc-identidad',
      algorithms: ['EdDSA'],
      requiredClaims: ['exp'],
      maxTokenAge: '15m',
    });
    const c = tokenClaimsSchema.parse(payload);
    return { tenantId: c.tid, usuarioId: c.sub, rol: c.rol, mfa: c.mfa };
  } catch (err) {
    // El motivo exacto nunca llega al cliente.
    request.log.debug({ err }, 'token rechazado');
    throw noAutenticado();
  }
}

/**
 * Autenticación JWT, contexto, trace id, logs y formato único de errores.
 * DEBE registrarse antes que cualquier ruta o plugin hijo: setErrorHandler/setNotFoundHandler no
 * llegan a plugins registrados antes. Los servicios deben construir su app con `createHttpApp`.
 */
export const platformPlugin = fp<PlatformPluginOptions>(
  async (app, opts) => {
    if (!opts.verificador && !opts.jwksUrl) {
      throw new Error('platformPlugin requiere `jwksUrl` o `verificador`');
    }
    const key: JWTVerifyGetKey = opts.verificador ?? createRemoteJWKSet(new URL(opts.jwksUrl as string));
    // `/salud` (healthcheck de contenedor, ver createHttpApp) es pública en todo servicio.
    const rutasPublicas = [...(opts.rutasPublicas ?? []), RUTA_SALUD];

    app.decorateRequest('ctx', undefined as unknown as RequestCtx);

    app.addHook('onRequest', async (request, reply) => {
      const traceId = sanitizeTraceId(request.headers['x-trace-id']);
      reply.header('x-trace-id', traceId);
      request.log = request.log.child({ trace_id: traceId });
      reply.log = request.log;
      if (isPublicPath(request.url, rutasPublicas)) {
        request.ctx = { traceId } as RequestCtx;
        return;
      }
      const auth = await autenticar(request, key);
      request.ctx = { ...auth, traceId };
      request.log = request.log.child({ tenant_id: auth.tenantId });
      reply.log = request.log;
    });

    app.setNotFoundHandler((_req, reply) => {
      void reply.code(404).send({ code: 'NO_ENCONTRADO', message: 'Recurso no encontrado' });
    });

    app.setErrorHandler((err, request, reply) => {
      const m = mapError(err);
      if (m.unexpected) request.log.error({ err }, 'error no controlado');
      void reply.code(m.status).send(m.body);
    });
  },
  { name: 'consultorio-platform' },
);

/** preHandler que exige que el rol del token esté entre `roles`; si no → 403 PROHIBIDO. */
export function requireRole(...roles: Rol[]): (request: { ctx?: Partial<RequestCtx> }) => Promise<void> {
  return async (request) => {
    const rol = request.ctx?.rol;
    if (!rol) throw noAutenticado();
    if (!roles.includes(rol)) throw new AppError('PROHIBIDO', 'Acceso prohibido', 403);
  };
}
