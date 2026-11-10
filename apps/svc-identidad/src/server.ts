import type { NatsConnection } from '@nats-io/transport-node';
import { createHttpApp, startOutboxPublisher } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, type JWK } from 'jose';
import type pg from 'pg';
import { createAuth } from './auth.js';
import { publicJwkFrom } from './jwt-keys.js';
import { authRoutes } from './routes/auth.js';
import { datosFiscalesRoutes } from './routes/datos-fiscales.js';
import { miembrosRoutes } from './routes/miembros.js';
import { perfilRoutes } from './routes/perfil.js';
import { createRegistroDeps, registroRoutes } from './routes/registro.js';
import { sesionRoutes } from './routes/sesion.js';

export interface ServerOptions {
  /** Pool del rol `identidad_app`. */
  pool: pg.Pool;
  /** Sin conexión NATS no se arranca el publicador del outbox (pruebas que solo miran la tabla). */
  nc?: NatsConnection;
  /** Llave Ed25519 con la que identidad firma los tokens de tenant; de ella se deriva el JWKS local. */
  jwtPrivateJwk: JWK;
  betterAuth: { secret: string; baseURL: string };
}

/** Rutas sin JWT de tenant. `/tenants/mios` y `/sesion/tenant` usan la sesión de Better Auth. */
export const RUTAS_PUBLICAS = ['/registro', '/auth/*', '/.well-known/jwks.json', '/tenants/mios', '/sesion/tenant'];

export async function buildServer(o: ServerOptions): Promise<FastifyInstance> {
  const verificador = createLocalJWKSet({ keys: [publicJwkFrom(o.jwtPrivateJwk)] });
  const app = await createHttpApp({
    servicio: 'svc-identidad',
    plugin: { verificador, rutasPublicas: RUTAS_PUBLICAS },
  });

  const auth = createAuth({ database: o.pool, secret: o.betterAuth.secret, baseURL: o.betterAuth.baseURL });
  await app.register(authRoutes, { auth });
  await app.register(registroRoutes, { deps: createRegistroDeps(o.pool, auth, app.log) });
  await app.register(sesionRoutes, { auth, pool: o.pool, jwtPrivateJwk: o.jwtPrivateJwk });
  await app.register(miembrosRoutes, { auth, pool: o.pool });
  await app.register(perfilRoutes, { pool: o.pool });
  await app.register(datosFiscalesRoutes, { pool: o.pool });

  if (o.nc) {
    const publicador = startOutboxPublisher({
      pool: o.pool,
      nc: o.nc,
      onError: (err) => app.log.error({ err }, 'publicador del outbox'),
    });
    app.addHook('onClose', async () => {
      await publicador.stop();
    });
  }
  return app;
}
