export type ResultadoReinicio = 'ok' | 'no_encontrado' | 'compartida';

/**
 * Reiniciar la contraseña de un miembro: solo si lo es del consultorio del admin (si no, 404 para no
 * revelar cuentas ajenas) y no pertenece a otro consultorio (la cuenta es compartida: 409).
 */
export function puedeReiniciarPassword(i: { esMiembro: boolean; otrosConsultorios: number }): ResultadoReinicio {
  if (!i.esMiembro) return 'no_encontrado';
  return i.otrosConsultorios > 0 ? 'compartida' : 'ok';
}
