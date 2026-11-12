import type { TokenClaims } from '@consultorio/contracts';

/** Admin y recepción gestionan a cualquier médico; un médico, solo a sí mismo. */
export function puedeGestionarMedico(c: Pick<TokenClaims, 'sub' | 'rol' | 'admin'>, medicoId: string): boolean {
  return c.admin || c.rol === 'recepcion' || c.sub === medicoId;
}
