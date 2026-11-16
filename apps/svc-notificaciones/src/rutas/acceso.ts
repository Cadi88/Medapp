import { AppError, requireAdmin } from '@consultorio/platform';
import type { FastifyRequest } from 'fastify';

/** La pantalla de recordatorios y la configuración (lectura) son para admin o recepción; un médico sin admin recibe 403. */
export async function exigirPersonal(req: FastifyRequest): Promise<void> {
  const { admin, rol } = req.ctx;
  if (admin !== true && rol !== 'recepcion') throw new AppError('PROHIBIDO', 'Acceso prohibido', 403);
}

/** Solo admin (cambiar la configuración). */
export const exigirAdmin = requireAdmin();
