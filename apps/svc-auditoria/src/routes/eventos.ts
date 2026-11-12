import { requireAdmin, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { construirListado, parseConsulta } from '../consulta.js';

export const eventosRoutes: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get('/eventos', { preHandler: requireAdmin() }, async (req) => {
    const q = parseConsulta(req.query);
    const { text, values } = construirListado(req.ctx.tenantId, q);
    const eventos = await withTenant(pool, req.ctx.tenantId, async (tx) => (await tx.query<{ secuencia: string }>(text, values)).rows);
    // pg devuelve bigint como string: el cursor viaja como número JSON.
    const ultimo = eventos[eventos.length - 1];
    const siguiente = eventos.length === q.limite && ultimo !== undefined ? Number(ultimo.secuencia) : null;
    return { eventos, siguiente };
  });
};
