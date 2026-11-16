import { createHttpApp } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Puertos } from './puertos.js';

export interface ServerOptions {
  /** Pool del rol `notificaciones_app`. */
  pool: pg.Pool;
  /** JWKS de svc-identidad con el que se verifican los tokens de tenant. */
  jwksUrl: string;
  /** Reloj inyectable: el dominio nunca llama a `new Date()`. */
  reloj?: () => Date;
  /** Token de las rutas `/interno/*` (≥ 32 caracteres). */
  tokenInterno: string;
  /** Origen público del sitio web (enlaces de los correos). */
  webOrigen: string;
  /** Agenda, identidad, correo y almacén; las rutas y el programador (siguientes tareas) los usan. */
  puertos: Puertos;
}

export async function buildServer(o: ServerOptions): Promise<FastifyInstance> {
  // Sin rutas propias todavía: solo /salud (createHttpApp). Las rutas llegan en las siguientes tareas.
  return createHttpApp({ servicio: 'svc-notificaciones', plugin: { jwksUrl: o.jwksUrl } });
}
