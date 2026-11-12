import { semanaSchema } from '@consultorio/contracts';
import { AppError, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { esViolacionExclusion } from '../datos/errores.js';
import { leerHorario, reemplazarHorario } from '../datos/horario.js';
import { validarSemana } from '../dominio/horario.js';
import type { BloqueHorario } from '../dominio/tipos.js';
import { exigirGestion } from './acceso.js';

const params = z.object({ id: z.uuid() });

export const horarioRutas: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get('/medicos/:id/horario', async (req) => {
    const { id } = params.parse(req.params);
    const { tenantId } = req.ctx;
    return withTenant(pool, tenantId, async (tx) => {
      await exigirGestion(req, tx, id);
      return { bloques: await leerHorario(tx, tenantId, id) };
    });
  });

  app.put('/medicos/:id/horario', async (req) => {
    const { id } = params.parse(req.params);
    const { bloques } = semanaSchema.parse(req.body);
    const { tenantId } = req.ctx;
    const v = validarSemana(bloques as BloqueHorario[]);
    if (!v.ok) throw new AppError('VALIDACION', v.error, 400);
    try {
      return await withTenant(pool, tenantId, async (tx) => {
        await exigirGestion(req, tx, id);
        await reemplazarHorario(tx, tenantId, id, bloques);
        return { bloques: await leerHorario(tx, tenantId, id) };
      });
    } catch (err) {
      // La transacción ya revirtió: la semana anterior queda intacta.
      if (esViolacionExclusion(err)) throw new AppError('VALIDACION', 'Los bloques del horario se enciman', 400);
      throw err;
    }
  });
};
