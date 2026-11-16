import { actualizarConfigRecordatoriosSchema, ConfigRecordatoriosActualizada, type ConfigRecordatoriosDto } from '@consultorio/contracts';
import { AppError, enqueueEvent, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import { guardarConfig, leerConfig, type ConfigRecordatorios } from '../datos/config.js';
import { registrarConsultorio } from '../datos/consultorios.js';
import { recortarHora } from '../dominio/calendario.js';
import { validarPlantillas } from '../dominio/plantillas.js';
import { cambiosDeConfig } from '../dominio/recordatorios.js';
import type { ContextoEnvio } from '../envio.js';
import { exigirAdmin, exigirPersonal } from './acceso.js';

const aDto = (c: ConfigRecordatorios): ConfigRecordatoriosDto => ({ modo: c.modo, horaEnvio: recortarHora(c.horaEnvio), plantillas: c.plantillas });

export const configRutas: FastifyPluginAsync<{ ctx: ContextoEnvio }> = async (app, { ctx }) => {
  app.get('/config', { preHandler: exigirPersonal }, async (req) => {
    const { tenantId } = req.ctx;
    return aDto(await withTenant(ctx.pool, tenantId, (tx) => leerConfig(tx, tenantId)));
  });

  app.put('/config', { preHandler: exigirAdmin }, async (req) => {
    const cambios = actualizarConfigRecordatoriosSchema.parse(req.body);
    const { tenantId, usuarioId, traceId } = req.ctx;
    // La zona del consultorio se pide a identidad (fuera de la transacción) y se guarda con la configuración.
    const { zonaHoraria } = await ctx.puertos.identidad.obtenerConsultorio(tenantId);
    return withTenant(ctx.pool, tenantId, async (tx) => {
      // FOR UPDATE: dos PUT parciales simultáneos se serializan y ninguno pisa el cambio del otro.
      const actual = await leerConfig(tx, tenantId, true);
      const { nueva, campos } = cambiosDeConfig(actual, cambios);
      const v = validarPlantillas(nueva.plantillas);
      if (!v.ok) throw new AppError('VALIDACION', v.error, 400, [{ campo: v.campo }]);
      await registrarConsultorio(tx, tenantId, zonaHoraria);
      await guardarConfig(tx, tenantId, zonaHoraria, nueva, usuarioId);
      if (campos.length > 0) await enqueueEvent(tx, ConfigRecordatoriosActualizada.create({ tenantId, actorId: usuarioId, traceId, data: { campos } }));
      return aDto(nueva);
    });
  });
};
