import { requireAdmin, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { construirListado, parseConsulta } from '../consulta.js';

export const eventosRoutes: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get('/eventos', { preHandler: requireAdmin() }, async (req) => {
    const q = parseConsulta(req.query);
    const { text, values } = construirListado(req.ctx.tenantId, q);
    const eventos = await withTenant(pool, req.ctx.tenantId, async (tx) => (await tx.query(text, values)).rows);
    return { eventos };
  });
};
