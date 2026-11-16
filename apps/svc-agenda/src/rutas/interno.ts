import type { CitaParaRecordatorio } from '@consultorio/contracts';
import { AppError, rutasInternas, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { citasParaRecordatorio } from '../datos/citas.js';
import { leerZonaHoraria } from '../datos/medicos.js';
import { ventanaLocal } from '../dominio/ventana.js';

/** Rutas públicas para el plugin JWT: las protege `rutasInternas` (token) y el gateway las bloquea. */
export const RUTAS_INTERNAS = ['/interno/*'];

const query = z.object({ tenantId: z.uuid(), desde: z.string(), hasta: z.string() });

export interface InternoOpciones {
  pool: pg.Pool;
  tokenInterno: string;
}

export const internoRutas: FastifyPluginAsync<InternoOpciones> = async (app, { pool, tokenInterno }) => {
  await app.register(
    rutasInternas(tokenInterno, async (interno) => {
      /** Citas de los días locales [desde 00:00, hasta + 1 día 00:00) en la zona del consultorio. */
      interno.get('/interno/citas-para-recordatorio', async (req): Promise<{ citas: CitaParaRecordatorio[] }> => {
        const { tenantId, desde, hasta } = query.parse(req.query);
        const citas = await withTenant(pool, tenantId, async (tx) => {
          const zona = await leerZonaHoraria(tx, tenantId);
          if (!zona) throw new AppError('NO_ENCONTRADO', 'Consultorio no inicializado', 404);
          const v = ventanaLocal(desde, hasta, zona);
          if ('error' in v) throw new AppError('VALIDACION', v.error, 400, [{ campo: 'hasta' }]);
          return citasParaRecordatorio(tx, tenantId, v.inicioUtc, v.finUtc);
        });
        return { citas };
      });
    }),
  );
};
