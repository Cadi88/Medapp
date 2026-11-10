import { UsuarioDesvinculado, UsuarioVinculado, type Rol } from '@consultorio/contracts';
import { AppError, enqueueEvent, requireRole, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import type { Auth } from '../auth.js';
import { isUniqueViolation } from '../db/errors.js';
import { puedeEliminarMiembro } from '../reglas.js';
import { miembroSchema, uuidSchema } from '../validadores.js';

export interface MiembrosRoutesOptions {
  pool: pg.Pool;
  auth: Pick<Auth, 'api'>;
}

const yaMiembro = (): AppError => new AppError('CONFLICTO', 'La persona ya es miembro del consultorio', 409);

export const miembrosRoutes: FastifyPluginAsync<MiembrosRoutesOptions> = async (app, { pool, auth }) => {
  const idPorEmail = async (email: string): Promise<string | undefined> =>
    (await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;

  app.post('/miembros', { preHandler: requireRole('admin') }, async (req, reply) => {
    const input = miembroSchema.parse(req.body);
    const { tenantId, usuarioId: actorId, traceId } = req.ctx;

    // Usuario existente (de este u otro consultorio): se vincula tal cual, sin tocar su cuenta ni contraseña.
    let usuarioId = await idPorEmail(input.email);
    let creado = false;
    if (!usuarioId) {
      try {
        const r = await auth.api.signUpEmail({ body: { name: input.nombre, email: input.email, password: input.passwordTemporal } });
        usuarioId = r.user.id;
        creado = true;
      } catch (err) {
        // Carrera con otra alta del mismo email: Better Auth oculta el 23505; si el email ya existe, se vincula ese usuario.
        usuarioId = await idPorEmail(input.email);
        if (!usuarioId) throw err;
      }
    }

    const vinculado = usuarioId;
    try {
      await withTenant(pool, tenantId, async (tx) => {
        await tx.query('INSERT INTO membresia (tenant_id, usuario_id, rol) VALUES ($1, $2, $3)', [tenantId, vinculado, input.rol]);
        await enqueueEvent(tx, UsuarioVinculado.create({ tenantId, actorId, traceId, data: { usuarioId: vinculado, rol: input.rol } }));
      });
    } catch (err) {
      // Solo se compensa (borra) a un usuario que esta petición acaba de crear.
      if (creado) {
        try {
          await pool.query('DELETE FROM "user" WHERE id = $1', [vinculado]);
        } catch (errCompensacion) {
          req.log.error({ err: errCompensacion, usuarioId: vinculado }, 'compensación fallida: usuario huérfano tras alta de miembro');
        }
      }
      throw isUniqueViolation(err) ? yaMiembro() : err;
    }
    return reply.code(201).send({ usuarioId: vinculado, rol: input.rol });
  });

  app.delete('/miembros/:usuarioId', { preHandler: requireRole('admin') }, async (req, reply) => {
    const usuarioId = uuidSchema.parse((req.params as { usuarioId?: unknown }).usuarioId);
    const { tenantId, usuarioId: actorId, traceId } = req.ctx;

    await withTenant(pool, tenantId, async (tx) => {
      // Se bloquean las membresías de admin del tenant antes de contar: dos bajas concurrentes se
      // serializan y la segunda ve el resultado de la primera (nunca queda el tenant sin admin).
      const admins = await tx.query(
        'SELECT usuario_id FROM membresia WHERE tenant_id = $1 AND rol = $2 ORDER BY usuario_id FOR UPDATE',
        [tenantId, 'admin'],
      );
      const objetivo = await tx.query<{ rol: Rol }>('SELECT rol FROM membresia WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId]);
      const rolObjetivo = objetivo.rows[0]?.rol;
      if (!rolObjetivo) throw new AppError('NO_ENCONTRADO', 'Miembro no encontrado', 404);
      if (!puedeEliminarMiembro({ rolObjetivo, admins: admins.rowCount ?? 0 })) {
        throw new AppError('CONFLICTO', 'No se puede eliminar al último administrador', 409);
      }
      // perfil_medico referencia a la membresía (FK sin cascada).
      await tx.query('DELETE FROM perfil_medico WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId]);
      await tx.query('DELETE FROM membresia WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId]);
      await enqueueEvent(tx, UsuarioDesvinculado.create({ tenantId, actorId, traceId, data: { usuarioId } }));
    });
    return reply.code(204).send();
  });
};
