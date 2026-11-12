import { MedicoActualizado } from '@consultorio/contracts';
import { AppError, enqueueEvent, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { exigirActor } from '../actor.js';
import { puedeEditarPerfil } from '../dominio/reglas.js';
import { perfilSchema, uuidSchema } from '../validadores.js';

export interface PerfilRoutesOptions {
  pool: pg.Pool;
}

export const perfilRoutes: FastifyPluginAsync<PerfilRoutesOptions> = async (app, { pool }) => {
  app.put('/medicos/:usuarioId/perfil', async (req) => {
    const objetivoId = uuidSchema.parse((req.params as { usuarioId?: unknown }).usuarioId);
    const { tenantId, usuarioId: actorId, traceId } = req.ctx;
    const p = perfilSchema.parse(req.body);

    await withTenant(pool, tenantId, async (tx) => {
      // Permiso con el rol y el admin vigentes en la BD (no los del token): admin, o el propio médico.
      const actor = await exigirActor(tx, { tenantId, usuarioId: actorId });
      if (!puedeEditarPerfil({ ...actor, solicitanteId: actorId, objetivoId })) throw new AppError('PROHIBIDO', 'Acceso prohibido', 403);
      // RLS: solo se ven membresías de este tenant, así un médico de otro consultorio es 404.
      const m = await tx.query<{ rol: string }>('SELECT rol FROM membresia WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, objetivoId]);
      if (m.rows[0]?.rol !== 'medico') throw new AppError('NO_ENCONTRADO', 'Médico no encontrado', 404);
      await tx.query(
        `INSERT INTO perfil_medico (tenant_id, usuario_id, cedula_profesional, especialidad, cedula_especialidad, institucion)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, usuario_id) DO UPDATE SET
           cedula_profesional = EXCLUDED.cedula_profesional, especialidad = EXCLUDED.especialidad,
           cedula_especialidad = EXCLUDED.cedula_especialidad, institucion = EXCLUDED.institucion`,
        [tenantId, objetivoId, p.cedulaProfesional, p.especialidad ?? null, p.cedulaEspecialidad ?? null, p.institucion ?? null],
      );
      await enqueueEvent(
        tx,
        MedicoActualizado.create({
          tenantId,
          actorId,
          traceId,
          data: { usuarioId: objetivoId, cedulaProfesional: p.cedulaProfesional, especialidad: p.especialidad ?? '' },
        }),
      );
    });
    return { usuarioId: objetivoId, ...p };
  });
};
