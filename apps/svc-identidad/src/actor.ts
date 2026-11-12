import type { Rol } from '@consultorio/contracts';
import { AppError } from '@consultorio/platform';
import type pg from 'pg';

/** Rol de trabajo y permiso admin vigentes del actor en la BD. */
export interface ActorVigente {
  rol: Rol;
  admin: boolean;
}

/** Condiciones que se exigen al actor (todas deben cumplirse): permiso admin y/o rol de trabajo entre `roles`. */
export interface Requisito {
  admin?: true;
  roles?: readonly Rol[];
}

/**
 * Decisión pura: el actor vigente en la BD (undefined = ya no es miembro) debe existir y cumplir el requisito.
 * Los claims del token (válidos hasta 15 min) nunca bastan: un miembro removido o con otros permisos no actúa.
 */
export function actorAutorizado(actor: ActorVigente | undefined, req: Requisito): actor is ActorVigente {
  if (actor === undefined) return false;
  if (req.admin && !actor.admin) return false;
  if (req.roles && !req.roles.includes(actor.rol)) return false;
  return true;
}

/** Lanza 403 PROHIBIDO si el actor no cumple el requisito; devuelve su estado vigente. */
export function exigirActorVigente(actor: ActorVigente | undefined, req: Requisito): ActorVigente {
  if (!actorAutorizado(actor, req)) throw new AppError('PROHIBIDO', 'Acceso prohibido', 403);
  return actor;
}

/**
 * Dentro de la transacción del tenant: lee y bloquea (FOR SHARE) la membresía del actor, de modo que no
 * pueda ser removida mientras dura la operación, y exige que su estado vigente cumpla `req`.
 * Usar al inicio de TODO handler mutante. (DELETE /miembros bloquea las filas de admin FOR UPDATE primero,
 * para no cruzar bloqueos con otra baja concurrente, y usa `exigirActorVigente` con ese resultado.)
 */
export async function exigirActor(tx: pg.PoolClient, actor: { tenantId: string; usuarioId: string }, req: Requisito = {}): Promise<ActorVigente> {
  const r = await tx.query<ActorVigente>('SELECT rol, admin FROM membresia WHERE tenant_id = $1 AND usuario_id = $2 FOR SHARE', [
    actor.tenantId,
    actor.usuarioId,
  ]);
  return exigirActorVigente(r.rows[0], req);
}
