import { editarMiembroSchema, MiembroActualizado, UsuarioDesvinculado, UsuarioVinculado, type AltaMiembroRespuesta, type Miembro } from '@consultorio/contracts';
import { AppError, enqueueEvent, requireAdmin, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import type { Auth } from '../auth.js';
import { exigirActor } from '../actor.js';
import { isUniqueViolation } from '../db/errors.js';
import { puedeReiniciarPassword } from '../dominio/password-temporal.js';
import { puedeQuitarAdmin } from '../dominio/reglas.js';
import { altaMiembroSchema, passwordTemporalSchema, uuidSchema } from '../validadores.js';

export interface MiembrosRoutesOptions {
  pool: pg.Pool;
  auth: Pick<Auth, 'api' | '$context'>;
}

interface FilaMiembro {
  usuario_id: string;
  nombre: string;
  email: string;
  rol: Miembro['rol'];
  admin: boolean;
  mfa_activo: boolean;
  debe_cambiar_password: boolean;
  tiene_perfil: boolean;
  cedula_profesional: string | null;
  especialidad: string | null;
  cedula_especialidad: string | null;
  institucion: string | null;
}

/** Miembros del tenant (nombre y email de "user", perfil médico opcional), por nombre; `usuarioId` filtra a uno. */
async function leerMiembros(tx: pg.PoolClient, tenantId: string, usuarioId?: string): Promise<Miembro[]> {
  const r = await tx.query<FilaMiembro>(
    `SELECT m.usuario_id, u.name AS nombre, u.email, m.rol, m.admin,
            COALESCE(u."twoFactorEnabled", false) AS mfa_activo, u."debeCambiarPassword" AS debe_cambiar_password,
            p.usuario_id IS NOT NULL AS tiene_perfil,
            p.cedula_profesional, p.especialidad, p.cedula_especialidad, p.institucion
       FROM membresia m
       JOIN "user" u ON u.id = m.usuario_id
       LEFT JOIN perfil_medico p ON p.tenant_id = m.tenant_id AND p.usuario_id = m.usuario_id
      WHERE m.tenant_id = $1 AND ($2::uuid IS NULL OR m.usuario_id = $2)
      ORDER BY u.name, m.usuario_id`,
    [tenantId, usuarioId ?? null],
  );
  return r.rows.map((f) => ({
    usuarioId: f.usuario_id,
    nombre: f.nombre,
    email: f.email,
    rol: f.rol,
    admin: f.admin,
    mfaActivo: f.mfa_activo,
    debeCambiarPassword: f.debe_cambiar_password,
    perfilMedico: f.tiene_perfil
      ? {
          cedulaProfesional: f.cedula_profesional,
          especialidad: f.especialidad,
          cedulaEspecialidad: f.cedula_especialidad,
          institucion: f.institucion,
        }
      : null,
  }));
}

const yaMiembro = (): AppError => new AppError('CONFLICTO', 'La persona ya es miembro del consultorio', 409);

export const miembrosRoutes: FastifyPluginAsync<MiembrosRoutesOptions> = async (app, { pool, auth }) => {
  const idPorEmail = async (email: string): Promise<string | undefined> =>
    (await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;

  // Cualquier miembro autenticado.
  app.get('/miembros', async (req) => {
    const { tenantId } = req.ctx;
    return { miembros: await withTenant(pool, tenantId, (tx) => leerMiembros(tx, tenantId)) };
  });

  app.post('/miembros', { preHandler: requireAdmin() }, async (req, reply) => {
    const input = altaMiembroSchema.parse(req.body);
    const { tenantId, usuarioId: actorId, traceId } = req.ctx;

    // Antes de crear cuentas: el actor debe seguir siendo admin en la BD (el token vale hasta 15 min).
    await withTenant(pool, tenantId, (tx) => exigirActor(tx, { tenantId, usuarioId: actorId }, { admin: true }));

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
        await exigirActor(tx, { tenantId, usuarioId: actorId }, { admin: true });
        // Solo la cuenta recién creada nace con contraseña temporal; un usuario existente no se toca.
        if (creado) await tx.query('UPDATE "user" SET "debeCambiarPassword" = true WHERE id = $1', [vinculado]);
        await tx.query('INSERT INTO membresia (tenant_id, usuario_id, rol, admin) VALUES ($1, $2, $3, $4)', [
          tenantId,
          vinculado,
          input.rol,
          input.admin,
        ]);
        await enqueueEvent(
          tx,
          UsuarioVinculado.create({
            tenantId,
            actorId,
            traceId,
            data: { usuarioId: vinculado, nombre: input.nombre, rol: input.rol, admin: input.admin },
          }),
        );
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
    // `cuentaCreada: false`: la persona ya tenía cuenta y entra con su contraseña actual (la temporal no se aplicó).
    const respuesta: AltaMiembroRespuesta = { usuarioId: vinculado, rol: input.rol, admin: input.admin, cuentaCreada: creado };
    return reply.code(201).send(respuesta);
  });

  app.patch('/miembros/:usuarioId', { preHandler: requireAdmin() }, async (req) => {
    const usuarioId = uuidSchema.parse((req.params as { usuarioId?: unknown }).usuarioId);
    const cambio = editarMiembroSchema.parse(req.body);
    const { tenantId, usuarioId: actorId, traceId } = req.ctx;

    return withTenant(pool, tenantId, async (tx) => {
      // Mismo bloqueo que DELETE: PATCH y DELETE se serializan y la segunda operación ve el resultado de la primera.
      const admins = await tx.query<{ usuario_id: string }>(
        'SELECT usuario_id FROM membresia WHERE tenant_id = $1 AND admin = true ORDER BY usuario_id FOR UPDATE',
        [tenantId],
      );
      if (!admins.rows.some((a) => a.usuario_id === actorId)) throw new AppError('PROHIBIDO', 'Acceso prohibido', 403);
      const objetivo = (
        await tx.query<{ rol: Miembro['rol']; admin: boolean }>('SELECT rol, admin FROM membresia WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId])
      ).rows[0];
      if (!objetivo) throw new AppError('NO_ENCONTRADO', 'Miembro no encontrado', 404);
      if (cambio.admin === false && !puedeQuitarAdmin({ esAdminObjetivo: objetivo.admin, admins: admins.rowCount ?? 0 })) {
        throw new AppError('CONFLICTO', 'No se puede quitar el permiso al último administrador', 409);
      }
      const rol = cambio.rol ?? objetivo.rol;
      const admin = cambio.admin ?? objetivo.admin;
      // perfil_medico no se toca: al volver a médico conserva su cédula.
      await tx.query('UPDATE membresia SET rol = $3, admin = $4 WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId, rol, admin]);
      const miembro = (await leerMiembros(tx, tenantId, usuarioId))[0];
      if (!miembro) throw new AppError('NO_ENCONTRADO', 'Miembro no encontrado', 404);
      await enqueueEvent(tx, MiembroActualizado.create({ tenantId, actorId, traceId, data: { usuarioId, nombre: miembro.nombre, rol, admin } }));
      return miembro;
    });
  });

  app.delete('/miembros/:usuarioId', { preHandler: requireAdmin() }, async (req, reply) => {
    const usuarioId = uuidSchema.parse((req.params as { usuarioId?: unknown }).usuarioId);
    const { tenantId, usuarioId: actorId, traceId } = req.ctx;

    await withTenant(pool, tenantId, async (tx) => {
      // Se bloquean las membresías con admin del tenant antes de contar: dos bajas concurrentes se
      // serializan y la segunda ve el resultado de la primera (nunca queda el tenant sin admin).
      const admins = await tx.query(
        'SELECT usuario_id FROM membresia WHERE tenant_id = $1 AND admin = true ORDER BY usuario_id FOR UPDATE',
        [tenantId],
      );
      // El actor debe seguir siendo admin: sus filas están bloqueadas arriba (FOR UPDATE), así que no puede cambiar.
      if (!admins.rows.some((a: { usuario_id: string }) => a.usuario_id === actorId)) throw new AppError('PROHIBIDO', 'Acceso prohibido', 403);
      const objetivo = await tx.query<{ admin: boolean }>('SELECT admin FROM membresia WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId]);
      const esAdminObjetivo = objetivo.rows[0]?.admin;
      if (esAdminObjetivo === undefined) throw new AppError('NO_ENCONTRADO', 'Miembro no encontrado', 404);
      if (!puedeQuitarAdmin({ esAdminObjetivo, admins: admins.rowCount ?? 0 })) {
        throw new AppError('CONFLICTO', 'No se puede eliminar al último administrador', 409);
      }
      // perfil_medico referencia a la membresía (FK sin cascada).
      await tx.query('DELETE FROM perfil_medico WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId]);
      await tx.query('DELETE FROM membresia WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId]);
      await enqueueEvent(tx, UsuarioDesvinculado.create({ tenantId, actorId, traceId, data: { usuarioId } }));
    });
    return reply.code(204).send();
  });

  // Reinicio de contraseña por un admin: solo cuentas que pertenecen únicamente a este consultorio.
  app.post('/miembros/:usuarioId/password-temporal', { preHandler: requireAdmin() }, async (req, reply) => {
    const usuarioId = uuidSchema.parse((req.params as { usuarioId?: unknown }).usuarioId);
    const { passwordTemporal } = passwordTemporalSchema.parse(req.body);
    const { tenantId, usuarioId: actorId } = req.ctx;
    const hash = await (await auth.$context).password.hash(passwordTemporal);

    await withTenant(pool, tenantId, async (tx) => {
      await exigirActor(tx, { tenantId, usuarioId: actorId }, { admin: true });
      const esMiembro = (await tx.query('SELECT 1 FROM membresia WHERE tenant_id = $1 AND usuario_id = $2 FOR SHARE', [tenantId, usuarioId])).rowCount === 1;
      const otros = (await tx.query<{ n: number }>('SELECT fn_membresias_otros_consultorios($1, $2) AS n', [usuarioId, tenantId])).rows[0]?.n ?? 0;
      const decision = puedeReiniciarPassword({ esMiembro, otrosConsultorios: otros });
      if (decision === 'no_encontrado') throw new AppError('NO_ENCONTRADO', 'Miembro no encontrado', 404);
      if (decision === 'compartida') throw new AppError('CONFLICTO', 'La cuenta pertenece también a otro consultorio', 409);
      const cuenta = await tx.query(
        'UPDATE account SET password = $2, "updatedAt" = now() WHERE "userId" = $1 AND "providerId" = $3',
        [usuarioId, hash, 'credential'],
      );
      if (cuenta.rowCount !== 1) throw new AppError('NO_ENCONTRADO', 'Miembro no encontrado', 404);
      await tx.query('UPDATE "user" SET "debeCambiarPassword" = true, "updatedAt" = now() WHERE id = $1', [usuarioId]);
      await tx.query('DELETE FROM session WHERE "userId" = $1', [usuarioId]);
    });
    return reply.code(204).send();
  });
};
