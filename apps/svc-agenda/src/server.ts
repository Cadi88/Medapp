import { createHttpApp } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { bloqueosRutas } from './rutas/bloqueos.js';
import { disponibilidadRutas } from './rutas/disponibilidad.js';
import { horarioRutas } from './rutas/horario.js';
import { medicosRutas } from './rutas/medicos.js';
import { tiposCitaRutas } from './rutas/tipos-cita.js';

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
  const pool = o.pool;
  const reloj = o.reloj ?? (() => new Date());
  await app.register(medicosRutas, { pool });
  await app.register(tiposCitaRutas, { pool });
  await app.register(horarioRutas, { pool });
  await app.register(bloqueosRutas, { pool });
  await app.register(disponibilidadRutas, { pool, reloj });
  // Las rutas de citas se registran en la tarea siguiente.
  return app;
}
