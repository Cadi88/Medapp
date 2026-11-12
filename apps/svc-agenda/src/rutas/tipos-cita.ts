import { crearTipoCitaSchema, editarTipoCitaSchema } from '@consultorio/contracts';
import { AppError, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { esViolacionUnica } from '../datos/errores.js';
import { actualizarTipoCita, insertarTipoCita, listarTiposCita } from '../datos/tipos-cita.js';
import { exigirGestion } from './acceso.js';

const paramsMedico = z.object({ id: z.uuid() });
const paramsTipo = z.object({ id: z.uuid(), tipoId: z.uuid() });
const queryListado = z.object({ todos: z.enum(['1']).optional() });

const nombreDuplicado = (): AppError => new AppError('CONFLICTO', 'Ya existe un tipo de cita activo con ese nombre', 409);

export const tiposCitaRutas: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get('/medicos/:id/tipos-cita', async (req) => {
    const { id } = paramsMedico.parse(req.params);
    const { todos } = queryListado.parse(req.query);
    const { tenantId } = req.ctx;
    return withTenant(pool, tenantId, async (tx) => {
      await exigirGestion(req, tx, id);
      return { tiposCita: await listarTiposCita(tx, tenantId, id, todos === '1') };
    });
  });

  app.post('/medicos/:id/tipos-cita', async (req, reply) => {
    const { id } = paramsMedico.parse(req.params);
    const input = crearTipoCitaSchema.parse(req.body);
    const { tenantId } = req.ctx;
    try {
      const creado = await withTenant(pool, tenantId, async (tx) => {
        await exigirGestion(req, tx, id);
        return insertarTipoCita(tx, tenantId, { id: uuidv7(), medicoId: id, ...input });
      });
      return reply.code(201).send(creado);
    } catch (err) {
      throw esViolacionUnica(err) ? nombreDuplicado() : err;
    }
  });

  app.patch('/medicos/:id/tipos-cita/:tipoId', async (req) => {
    const { id, tipoId } = paramsTipo.parse(req.params);
    const cambios = editarTipoCitaSchema.parse(req.body);
    const { tenantId } = req.ctx;
    try {
      return await withTenant(pool, tenantId, async (tx) => {
        await exigirGestion(req, tx, id);
        const t = await actualizarTipoCita(tx, tenantId, id, tipoId, cambios);
        if (!t) throw new AppError('NO_ENCONTRADO', 'Tipo de cita no encontrado', 404);
        return t;
      });
    } catch (err) {
      throw esViolacionUnica(err) ? nombreDuplicado() : err;
    }
  });
};
