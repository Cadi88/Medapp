import type { Rol } from '@consultorio/contracts';

/** MFA obligatorio para quien tiene rol `medico` o el permiso `admin` (restricciones globales). */
export function exigeMfa(m: { rol: Rol; admin: boolean }): boolean {
  return m.rol === 'medico' || m.admin;
}

export type DecisionToken = { ok: true; mfa: boolean } | { ok: false };

/** Decide si se puede emitir token de tenant y qué valor lleva el claim `mfa`. */
export function decidirToken(i: { rol: Rol; admin: boolean; twoFactorEnabled: boolean | null | undefined }): DecisionToken {
  const mfa = i.twoFactorEnabled === true;
  if (exigeMfa(i) && !mfa) return { ok: false };
  return { ok: true, mfa };
}

/**
 * Un tenant nunca debe quedarse sin admin. `admins` es el número de miembros con `admin = true` leído con
 * esas membresías bloqueadas (FOR UPDATE). Sirve para la baja del miembro y para quitarle el permiso.
 */
export function puedeQuitarAdmin(i: { esAdminObjetivo: boolean; admins: number }): boolean {
  return !i.esAdminObjetivo || i.admins > 1;
}

/** Perfil médico: un admin edita cualquiera; un médico solo el suyo. */
export function puedeEditarPerfil(i: { rol: Rol; admin: boolean; solicitanteId: string; objetivoId: string }): boolean {
  if (i.admin) return true;
  return i.rol === 'medico' && i.solicitanteId === i.objetivoId;
}

/** Rol de trabajo del fundador del consultorio (siempre con permiso admin). */
export function rolFundador(esMedico: boolean): Rol {
  return esMedico ? 'medico' : 'recepcion';
}
