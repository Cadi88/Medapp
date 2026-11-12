import { AppError } from '@consultorio/platform';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { existeMedico } from '../datos/medicos.js';
import { puedeGestionarMedico } from '../dominio/permisos.js';

export interface OpcionesGestion {
  /**
   * Acepta a un médico inactivo. Solo para operar sobre citas que ya existen (ver, cambiar estado, reasignar): spec §3.2,
   * "sus citas existentes se conservan". Crear citas o configurar su agenda exige que esté activo.
   */
  permitirInactivo?: boolean;
}

/**
 * Autoriza al actor sobre la agenda del médico: 403 si no puede gestionarlo, 404 si no existe en el tenant
 * (o está inactivo, salvo `permitirInactivo`). El permiso se decide primero y sin tocar la base.
 */
export async function exigirGestion(req: FastifyRequest, tx: pg.PoolClient, medicoId: string, opciones: OpcionesGestion = {}): Promise<void> {
  const { tenantId, usuarioId, rol, admin } = req.ctx;
  if (!puedeGestionarMedico({ sub: usuarioId, rol, admin }, medicoId)) throw new AppError('PROHIBIDO', 'Acceso prohibido', 403);
  const soloActivos = !opciones.permitirInactivo;
  if (!(await existeMedico(tx, tenantId, medicoId, soloActivos))) throw new AppError('NO_ENCONTRADO', 'Médico no encontrado', 404);
}
