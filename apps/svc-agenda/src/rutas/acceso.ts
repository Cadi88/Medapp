import { AppError } from '@consultorio/platform';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { existeMedicoActivo } from '../datos/medicos.js';
import { puedeGestionarMedico } from '../dominio/permisos.js';

/**
 * Autoriza al actor sobre la agenda del médico: 403 si no puede gestionarlo, 404 si no existe
 * (o está inactivo) en el tenant. El permiso se decide primero y sin tocar la base.
 */
export async function exigirGestion(req: FastifyRequest, tx: pg.PoolClient, medicoId: string): Promise<void> {
  const { tenantId, usuarioId, rol, admin } = req.ctx;
  if (!puedeGestionarMedico({ sub: usuarioId, rol, admin }, medicoId)) throw new AppError('PROHIBIDO', 'Acceso prohibido', 403);
  if (!(await existeMedicoActivo(tx, tenantId, medicoId))) throw new AppError('NO_ENCONTRADO', 'Médico no encontrado', 404);
}
