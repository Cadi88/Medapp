import { withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { listarMedicosActivos } from '../datos/medicos.js';

export const medicosRutas: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  // Admin y recepción ven a todos; un médico, solo a sí mismo.
  app.get('/medicos', async (req) => {
    const { tenantId, usuarioId, rol, admin } = req.ctx;
    const todos = admin || rol === 'recepcion';
    return { medicos: await withTenant(pool, tenantId, (tx) => listarMedicosActivos(tx, tenantId, todos ? undefined : usuarioId)) };
  });
};
