import { createHttpApp } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export interface ServerOptions {
  /** Pool del rol `agenda_app`. */
  pool: pg.Pool;
  /** JWKS de svc-identidad con el que se verifican los tokens de tenant. */
  jwksUrl: string;
  /** Reloj inyectable: el dominio nunca llama a `new Date()`. */
  reloj?: () => Date;
}

export async function buildServer(o: ServerOptions): Promise<FastifyInstance> {
  const app = await createHttpApp({ servicio: 'svc-agenda', plugin: { jwksUrl: o.jwksUrl, rutasPublicas: [] } });
  // Las rutas (tipos de cita, horarios, citas) se registran en las tareas siguientes con { pool: o.pool, reloj }.
  return app;
}
