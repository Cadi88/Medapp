import type { CitaParaRecordatorio } from '@consultorio/contracts';
import { AppError, requireTokenInterno, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import { DateTime } from 'luxon';
import type pg from 'pg';
import { z } from 'zod';
import { citasParaRecordatorio } from '../datos/citas.js';
import { leerZonaHoraria } from '../datos/medicos.js';

/** Rutas públicas para el plugin JWT: las protege `requireTokenInterno` y el gateway las bloquea. */
export const RUTAS_INTERNAS = ['/interno/*'];

/** Días (inclusive) que puede abarcar una consulta. */
const MAX_DIAS = 8;
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((f) => DateTime.fromISO(f).isValid, { message: 'Fecha inválida' });
const query = z
  .object({ tenantId: z.uuid(), desde: fecha, hasta: fecha })
  .refine((q) => q.hasta >= q.desde && DateTime.fromISO(q.hasta).diff(DateTime.fromISO(q.desde), 'days').days + 1 <= MAX_DIAS, {
    message: `El rango debe ser de 1 a ${MAX_DIAS} días`,
    path: ['hasta'],
  });

export interface InternoOpciones {
  pool: pg.Pool;
  tokenInterno: string;
}

export const internoRutas: FastifyPluginAsync<InternoOpciones> = async (app, { pool, tokenInterno }) => {
  /** Citas de los días locales [desde 00:00, hasta + 1 día 00:00) en la zona del consultorio. */
  app.get('/interno/citas-para-recordatorio', { preHandler: requireTokenInterno(tokenInterno) }, async (req): Promise<{ citas: CitaParaRecordatorio[] }> => {
    const { tenantId, desde, hasta } = query.parse(req.query);
    const citas = await withTenant(pool, tenantId, async (tx) => {
      const zona = await leerZonaHoraria(tx, tenantId);
      if (!zona) throw new AppError('NO_ENCONTRADO', 'Consultorio no inicializado', 404);
      const inicio = DateTime.fromISO(desde, { zone: zona }).startOf('day');
      const fin = DateTime.fromISO(hasta, { zone: zona }).plus({ days: 1 }).startOf('day');
      return citasParaRecordatorio(tx, tenantId, inicio.toJSDate(), fin.toJSDate());
    });
    return { citas };
  });
};
