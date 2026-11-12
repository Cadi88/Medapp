import type { Consultorio } from '@consultorio/contracts';
import { AppError, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';

export interface ConsultorioRoutesOptions {
  pool: pg.Pool;
}

export const consultorioRoutes: FastifyPluginAsync<ConsultorioRoutesOptions> = async (app, { pool }) => {
  // Cualquier miembro autenticado. `tenant` no tiene RLS: se filtra por el tenant del token.
  app.get('/consultorio', async (req): Promise<Consultorio> => {
    const { tenantId } = req.ctx;
    const fila = await withTenant(pool, tenantId, async (tx) =>
      (await tx.query<Consultorio>('SELECT id, nombre, slug, zona_horaria AS "zonaHoraria" FROM tenant WHERE id = $1', [tenantId])).rows[0],
    );
    if (!fila) throw new AppError('NO_ENCONTRADO', 'Consultorio no encontrado', 404);
    return fila;
  });
};
