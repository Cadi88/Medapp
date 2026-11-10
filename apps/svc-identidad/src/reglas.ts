import type { Rol } from '@consultorio/contracts';

/** MFA obligatorio para `admin` y `medico` (restricciones globales). */
export function exigeMfa(rol: Rol): boolean {
  return rol === 'admin' || rol === 'medico';
}

export type DecisionToken = { ok: true; mfa: boolean } | { ok: false };

/** Decide si se puede emitir token de tenant y qué valor lleva el claim `mfa`. */
export function decidirToken(i: { rol: Rol; twoFactorEnabled: boolean | null | undefined }): DecisionToken {
  const mfa = i.twoFactorEnabled === true;
  if (exigeMfa(i.rol) && !mfa) return { ok: false };
  return { ok: true, mfa };
}

/**
 * Un tenant nunca debe quedarse sin admin. `admins` es el número de admins del tenant leído con
 * las membresías de admin bloqueadas (FOR UPDATE).
 */
export function puedeEliminarMiembro(i: { rolObjetivo: Rol; admins: number }): boolean {
  return i.rolObjetivo !== 'admin' || i.admins > 1;
}

/** Perfil médico: admin edita cualquiera; un médico solo el suyo. */
export function puedeEditarPerfil(i: { rol: Rol; solicitanteId: string; objetivoId: string }): boolean {
  if (i.rol === 'admin') return true;
  return i.rol === 'medico' && i.solicitanteId === i.objetivoId;
}
