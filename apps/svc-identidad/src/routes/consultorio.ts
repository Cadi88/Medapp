import { colorDeTexto, ConsultorioActualizado, personalizacionSchema, type CodigoPais, type Consultorio } from '@consultorio/contracts';
import { AppError, enqueueEvent, requireAdmin, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { exigirActor } from '../actor.js';
import { resolverPersonalizacion, type ValoresPersonalizacion } from '../dominio/personalizacion.js';

type FilaConsultorio = Omit<Consultorio, 'colorTexto'>;

export interface ConsultorioRoutesOptions {
  pool: pg.Pool;
}

/** `tenant` no tiene RLS: se filtra por el tenant del token. `logoVersion` 0 = sin logo (también tras quitarlo); nunca toca el almacenamiento. */
async function leerConsultorio(tx: pg.PoolClient, tenantId: string): Promise<Consultorio> {
  const fila = (
    await tx.query<FilaConsultorio>(
      `SELECT id, nombre, slug, zona_horaria AS "zonaHoraria", nombre_comercial AS "nombreComercial", direccion, telefono,
              color_primario AS "colorPrimario", CASE WHEN logo_key IS NULL THEN 0 ELSE logo_version END AS "logoVersion", pais, moneda
       FROM tenant WHERE id = $1`,
      [tenantId],
    )
  ).rows[0];
  if (!fila) throw new AppError('NO_ENCONTRADO', 'Consultorio no encontrado', 404);
  return { ...fila, colorTexto: fila.colorPrimario ? colorDeTexto(fila.colorPrimario) : null };
}

interface FilaBloqueada extends ValoresPersonalizacion {
  pais: CodigoPais;
}

export const consultorioRoutes: FastifyPluginAsync<ConsultorioRoutesOptions> = async (app, { pool }) => {
  // Cualquier miembro autenticado.
  app.get('/consultorio', async (req): Promise<Consultorio> => withTenant(pool, req.ctx.tenantId, (tx) => leerConsultorio(tx, req.ctx.tenantId)));

  app.patch('/consultorio/personalizacion', { preHandler: requireAdmin() }, async (req): Promise<Consultorio> => {
    const entrada = personalizacionSchema.parse(req.body);
    const { tenantId, usuarioId: actorId, traceId } = req.ctx;
    return withTenant(pool, tenantId, async (tx) => {
      await exigirActor(tx, { tenantId, usuarioId: actorId }, { admin: true });
      const actual = (
        await tx.query<FilaBloqueada>(
          `SELECT nombre_comercial AS "nombreComercial", direccion, telefono, color_primario AS "colorPrimario", pais
           FROM tenant WHERE id = $1 FOR UPDATE`,
          [tenantId],
        )
      ).rows[0];
      if (!actual) throw new AppError('NO_ENCONTRADO', 'Consultorio no encontrado', 404);
      const r = resolverPersonalizacion(entrada, actual.pais, actual);
      if (!r.ok) throw new AppError('VALIDACION', r.mensaje, 400, [{ campo: r.campo }]);
      if (r.cambiados.length > 0) {
        const n = r.nuevos;
        await tx.query('UPDATE tenant SET nombre_comercial = $2, direccion = $3, telefono = $4, color_primario = $5 WHERE id = $1', [
          tenantId,
          n.nombreComercial,
          n.direccion,
          n.telefono,
          n.colorPrimario,
        ]);
        await enqueueEvent(tx, ConsultorioActualizado.create({ tenantId, actorId, traceId, data: { campos: r.cambiados } }));
      }
      return leerConsultorio(tx, tenantId);
    });
  });
};
