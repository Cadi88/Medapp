import { colorDeTexto, type ConsultorioParaMensaje, type CodigoPais } from '@consultorio/contracts';
import { AppError, rutasInternas, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';

/** Rutas públicas para el plugin JWT: las protege `rutasInternas` (token) y el gateway las bloquea. */
export const RUTAS_INTERNAS = ['/interno/*'];

const query = z.object({ tenantId: z.uuid() });

interface Fila {
  nombreMostrado: string;
  telefono: string | null;
  colorPrimario: string | null;
  logoKey: string | null;
  zonaHoraria: string;
  pais: CodigoPais;
}

export interface InternoRoutesOptions {
  pool: pg.Pool;
  tokenInterno: string;
}

export const internoRoutes: FastifyPluginAsync<InternoRoutesOptions> = async (app, { pool, tokenInterno }) => {
  await app.register(
    rutasInternas(tokenInterno, async (interno) => {
      /** Solo datos de marca; nada de contacto de personas. */
      interno.get('/interno/consultorio-para-mensaje', async (req): Promise<ConsultorioParaMensaje> => {
        const { tenantId } = query.parse(req.query);
        const fila = await withTenant(
          pool,
          tenantId,
          async (tx) =>
            (
              await tx.query<Fila>(
                `SELECT COALESCE(nombre_comercial, nombre) AS "nombreMostrado", telefono, color_primario AS "colorPrimario", logo_key AS "logoKey",
                        zona_horaria AS "zonaHoraria", pais
                 FROM tenant WHERE id = $1`,
                [tenantId],
              )
            ).rows[0],
        );
        if (!fila) throw new AppError('NO_ENCONTRADO', 'Consultorio no encontrado', 404);
        return { ...fila, colorTexto: fila.colorPrimario ? colorDeTexto(fila.colorPrimario) : null };
      });
    }),
  );
};
