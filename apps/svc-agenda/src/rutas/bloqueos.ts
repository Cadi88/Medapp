import { crearBloqueoSchema } from '@consultorio/contracts';
import { AppError, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { borrarBloqueo, insertarBloqueo, listarBloqueos } from '../datos/bloqueos.js';
import { exigirGestion } from './acceso.js';

const paramsMedico = z.object({ id: z.uuid() });
const paramsBloqueo = z.object({ id: z.uuid(), bloqueoId: z.uuid() });
const instante = z.iso.datetime({ offset: true });
const queryListado = z.object({ desde: instante.optional(), hasta: instante.optional() });

export const bloqueosRutas: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get('/medicos/:id/bloqueos', async (req) => {
    const { id } = paramsMedico.parse(req.params);
    const { desde, hasta } = queryListado.parse(req.query);
    const { tenantId } = req.ctx;
    return withTenant(pool, tenantId, async (tx) => {
      await exigirGestion(req, tx, id);
      return { bloqueos: await listarBloqueos(tx, tenantId, id, desde, hasta) };
    });
  });

  app.post('/medicos/:id/bloqueos', async (req, reply) => {
    const { id } = paramsMedico.parse(req.params);
    const input = crearBloqueoSchema.parse(req.body);
    const { tenantId } = req.ctx;
    const creado = await withTenant(pool, tenantId, async (tx) => {
      await exigirGestion(req, tx, id);
      return insertarBloqueo(tx, tenantId, { id: uuidv7(), medicoId: id, ...input });
    });
    return reply.code(201).send(creado);
  });

  app.delete('/medicos/:id/bloqueos/:bloqueoId', async (req, reply) => {
    const { id, bloqueoId } = paramsBloqueo.parse(req.params);
    const { tenantId } = req.ctx;
    await withTenant(pool, tenantId, async (tx) => {
      await exigirGestion(req, tx, id);
      if (!(await borrarBloqueo(tx, tenantId, id, bloqueoId))) throw new AppError('NO_ENCONTRADO', 'Bloqueo no encontrado', 404);
    });
    return reply.code(204).send();
  });
};
