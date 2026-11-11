import { requireRole, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { exigirActor } from '../actor.js';
import { datosFiscalesSchema } from '../validadores.js';

export interface DatosFiscalesRoutesOptions {
  pool: pg.Pool;
}

export const datosFiscalesRoutes: FastifyPluginAsync<DatosFiscalesRoutesOptions> = async (app, { pool }) => {
  app.put('/datos-fiscales', { preHandler: requireRole('admin') }, async (req) => {
    const d = datosFiscalesSchema.parse(req.body);
    const { tenantId, usuarioId } = req.ctx;
    await withTenant(pool, tenantId, async (tx) => {
      await exigirActor(tx, { tenantId, usuarioId }, ['admin']);
      await tx.query(
        `INSERT INTO datos_fiscales (tenant_id, rfc, razon_social, regimen_fiscal, cp) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET
           rfc = EXCLUDED.rfc, razon_social = EXCLUDED.razon_social, regimen_fiscal = EXCLUDED.regimen_fiscal, cp = EXCLUDED.cp`,
        [tenantId, d.rfc, d.razonSocial, d.regimenFiscal, d.cp],
      );
    });
    return d;
  });
};
