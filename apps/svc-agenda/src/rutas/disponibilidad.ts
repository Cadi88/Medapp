import type { Disponibilidad } from '@consultorio/contracts';
import { AppError, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import { DateTime } from 'luxon';
import type pg from 'pg';
import { z } from 'zod';
import { rangosOcupados } from '../datos/bloqueos.js';
import { leerHorario } from '../datos/horario.js';
import { leerZonaHoraria } from '../datos/medicos.js';
import { leerTipoCita } from '../datos/tipos-cita.js';
import { huecosLibres } from '../dominio/disponibilidad.js';
import { exigirGestion } from './acceso.js';

const params = z.object({ id: z.uuid() });
const query = z.object({
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((f) => DateTime.fromISO(f).isValid, { message: 'Fecha inválida' }),
  tipoCitaId: z.uuid(),
});

export interface DisponibilidadOpciones {
  pool: pg.Pool;
  reloj: () => Date;
}

export const disponibilidadRutas: FastifyPluginAsync<DisponibilidadOpciones> = async (app, { pool, reloj }) => {
  app.get('/medicos/:id/disponibilidad', async (req): Promise<Disponibilidad> => {
    const { id } = params.parse(req.params);
    const { fecha, tipoCitaId } = query.parse(req.query);
    const { tenantId } = req.ctx;
    const huecos = await withTenant(pool, tenantId, async (tx) => {
      await exigirGestion(req, tx, id);
      const zona = await leerZonaHoraria(tx, tenantId);
      if (!zona) throw new AppError('NO_ENCONTRADO', 'Consultorio no inicializado', 404);
      const tipo = await leerTipoCita(tx, tenantId, id, tipoCitaId);
      if (!tipo?.activo) throw new AppError('NO_ENCONTRADO', 'Tipo de cita no encontrado', 404);

      // Día local [00:00, 00:00 siguiente) convertido a UTC; correcto también en días de cambio de horario.
      const inicioDia = DateTime.fromISO(fecha, { zone: zona }).startOf('day');
      const finDia = inicioDia.plus({ days: 1 }).startOf('day');
      return huecosLibres({
        fecha,
        zona,
        bloques: await leerHorario(tx, tenantId, id),
        ocupados: await rangosOcupados(tx, tenantId, id, inicioDia.toUTC(), finDia.toUTC()),
        duracionMin: tipo.duracionMin,
        ahora: DateTime.fromJSDate(reloj(), { zone: 'utc' }),
      });
    });
    return { fecha, tipoCitaId, huecos };
  });
};
