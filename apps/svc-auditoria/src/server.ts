import { createHttpApp } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { eventosRoutes } from './routes/eventos.js';

export interface ServerOptions {
  /** Pool del rol `auditoria_app`. */
  pool: pg.Pool;
  /** JWKS de svc-identidad con el que se verifican los tokens de tenant. */
  jwksUrl: string;
}

export async function buildServer(o: ServerOptions): Promise<FastifyInstance> {
  const app = await createHttpApp({ servicio: 'svc-auditoria', plugin: { jwksUrl: o.jwksUrl, rutasPublicas: [] } });
  await app.register(eventosRoutes, { pool: o.pool });
  return app;
}
