import type { Rol } from '@consultorio/contracts';
import { AppError } from '@consultorio/platform';
import type pg from 'pg';

/**
 * Decisión pura: el rol vigente en la BD (undefined = ya no es miembro) debe existir y estar entre los permitidos.
 * El rol del token (válido hasta 15 min) nunca basta: un miembro removido o con otro rol no actúa.
 */
export function actorAutorizado(rolDb: Rol | undefined, permitidos: readonly Rol[]): rolDb is Rol {
  return rolDb !== undefined && permitidos.includes(rolDb);
}

/** Lanza 403 PROHIBIDO si el actor no está autorizado; devuelve su rol vigente. */
export function exigirRolVigente(rolDb: Rol | undefined, permitidos: readonly Rol[]): Rol {
  if (!actorAutorizado(rolDb, permitidos)) throw new AppError('PROHIBIDO', 'Acceso prohibido', 403);
  return rolDb;
}

/**
 * Dentro de la transacción del tenant: lee y bloquea (FOR SHARE) la membresía del actor, de modo que no
 * pueda ser removida mientras dura la operación, y exige que su rol vigente esté entre `permitidos`.
 * Usar al inicio de TODO handler mutante. (DELETE /miembros bloquea las filas de admin FOR UPDATE primero,
 * para no cruzar bloqueos con otra baja concurrente, y usa `exigirRolVigente` con ese resultado.)
 */
export async function exigirActor(
  tx: pg.PoolClient,
  actor: { tenantId: string; usuarioId: string },
  permitidos: readonly Rol[],
): Promise<Rol> {
  const r = await tx.query<{ rol: Rol }>('SELECT rol FROM membresia WHERE tenant_id = $1 AND usuario_id = $2 FOR SHARE', [
    actor.tenantId,
    actor.usuarioId,
  ]);
  return exigirRolVigente(r.rows[0]?.rol, permitidos);
}
