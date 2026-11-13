import { ConsultorioActualizado } from '@consultorio/contracts';
import { AppError, enqueueEvent, mapError, requireAdmin, uuidv7, withTenant, type Almacen } from '@consultorio/platform';
import type { FastifyBaseLogger, FastifyPluginAsync, RouteShorthandOptions } from 'fastify';
import type pg from 'pg';
import { exigirActor } from '../actor.js';
import { detectarFormato } from '../dominio/logo.js';
import { procesarLogo } from '../logo/procesar.js';

export interface LogoRoutesOptions {
  pool: pg.Pool;
  almacen: Almacen;
}

const MAX_ARCHIVO = 1024 * 1024;
const MAX_CUERPO = 2 * 1024 * 1024;
const MENSAJE_GRANDE = 'El logo debe pesar menos de 1 MB';
const servicioNoDisponible = (): AppError => new AppError('INTERNO', 'Servicio no disponible', 503);

/** Borra una llave ya huérfana: el fallo solo se registra (la fila de la base ya no la referencia). */
async function borrarSinFallar(almacen: Almacen, log: FastifyBaseLogger, llave: string): Promise<void> {
  try {
    await almacen.borrar(llave);
  } catch (err) {
    log.warn({ err, llave }, 'no se pudo borrar un logo huérfano del almacenamiento');
  }
}

export const logoRoutes: FastifyPluginAsync<LogoRoutesOptions> = async (app, { pool, almacen }) => {
  // El archivo llega crudo (no multipart); el parser solo existe en este plugin. Acepta cualquier image/* y
  // application/octet-stream: el formato real lo decide `detectarFormato` por los bytes (400 con el texto de la spec).
  for (const tipo of [/^image\/.+/, 'application/octet-stream']) {
    app.addContentTypeParser(tipo, { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });
  }

  /** Un cuerpo de más de 2 MB (límite HTTP) se responde con el mismo texto que un archivo de más de 1 MB. */
  const errorSubida: RouteShorthandOptions['errorHandler'] = (err, req, reply) => {
    if ((err as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(400).send({ code: 'VALIDACION', message: MENSAJE_GRANDE, details: { campo: 'logo' } });
    }
    const m = mapError(err);
    if (m.unexpected) req.log.error({ err }, 'error no controlado');
    return reply.code(m.status).send(m.body);
  };

  /**
   * Cambia `logo_key` (nueva llave o NULL) bajo `FOR UPDATE` y emite el evento en la misma transacción.
   * Devuelve la llave anterior y la nueva versión; `null` si no había nada que cambiar (quitar sin logo).
   */
  async function reemplazarLlave(req: { ctx: { tenantId: string; usuarioId: string; traceId: string } }, nueva: string | null) {
    const { tenantId, usuarioId: actorId, traceId } = req.ctx;
    return withTenant(pool, tenantId, async (tx) => {
      await exigirActor(tx, { tenantId, usuarioId: actorId }, { admin: true });
      const fila = (await tx.query<{ logo_key: string | null }>('SELECT logo_key FROM tenant WHERE id = $1 FOR UPDATE', [tenantId])).rows[0];
      if (!fila) throw new AppError('NO_ENCONTRADO', 'Consultorio no encontrado', 404);
      if (nueva === null && fila.logo_key === null) return null;
      const v = (await tx.query<{ logo_version: number }>('UPDATE tenant SET logo_key = $2, logo_version = logo_version + 1 WHERE id = $1 RETURNING logo_version', [tenantId, nueva])).rows[0];
      await enqueueEvent(tx, ConsultorioActualizado.create({ tenantId, actorId, traceId, data: { campos: ['logo'] } }));
      return { anterior: fila.logo_key, logoVersion: v?.logo_version ?? 0 };
    });
  }

  app.put('/consultorio/logo', { preHandler: requireAdmin(), bodyLimit: MAX_CUERPO, errorHandler: errorSubida }, async (req) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length > MAX_ARCHIVO) throw new AppError('VALIDACION', MENSAJE_GRANDE, 400, { campo: 'logo' });
    if (detectarFormato(bytes) === null) throw new AppError('VALIDACION', 'Sube una imagen PNG, JPG o WebP', 400);
    const png = await procesarLogo(bytes);

    const llave = `logos/${req.ctx.tenantId}/${uuidv7()}.png`;
    try {
      await almacen.guardar(llave, png, 'image/png');
    } catch (err) {
      req.log.warn({ err, llave }, 'no se pudo guardar el logo');
      throw servicioNoDisponible();
    }
    let r;
    try {
      r = await reemplazarLlave(req, llave);
    } catch (err) {
      await borrarSinFallar(almacen, req.log, llave);
      throw err;
    }
    if (r?.anterior) await borrarSinFallar(almacen, req.log, r.anterior);
    return { logoVersion: r?.logoVersion ?? 0 };
  });

  app.delete('/consultorio/logo', { preHandler: requireAdmin() }, async (req, reply) => {
    const r = await reemplazarLlave(req, null);
    if (r?.anterior) await borrarSinFallar(almacen, req.log, r.anterior);
    return reply.code(204).send();
  });

  // Cualquier miembro: el logo es el del tenant del token, nunca el de otro.
  app.get('/consultorio/logo', async (req, reply) => {
    const { tenantId } = req.ctx;
    const fila = await withTenant(pool, tenantId, async (tx) => (await tx.query<{ logo_key: string | null }>('SELECT logo_key FROM tenant WHERE id = $1', [tenantId])).rows[0]);
    if (!fila?.logo_key) throw new AppError('NO_ENCONTRADO', 'Sin logo', 404);
    let objeto;
    try {
      objeto = await almacen.leer(fila.logo_key);
    } catch (err) {
      req.log.warn({ err, llave: fila.logo_key }, 'no se pudo leer el logo');
      throw servicioNoDisponible();
    }
    if (!objeto) throw new AppError('NO_ENCONTRADO', 'Sin logo', 404);
    return reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=86400').send(Buffer.from(objeto.bytes));
  });
};
