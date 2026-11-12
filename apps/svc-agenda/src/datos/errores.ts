import { AppError } from '@consultorio/platform';

const codigo = (err: unknown): unknown => (typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined);

/** Violación de UNIQUE (SQLSTATE 23505). */
export const esViolacionUnica = (err: unknown): boolean => codigo(err) === '23505';

/** Violación de EXCLUDE (SQLSTATE 23P01). */
export const esViolacionExclusion = (err: unknown): boolean => codigo(err) === '23P01';

/** Traduce a un error de negocio las violaciones de restricciones que expresan reglas del dominio; `null` si no aplica. */
export function traducirErrorPg(err: unknown): AppError | null {
  const restriccion = typeof err === 'object' && err !== null ? (err as { constraint?: unknown }).constraint : undefined;
  if (esViolacionExclusion(err) && restriccion === 'cita_sin_traslape') {
    return new AppError('HORARIO_OCUPADO', 'El médico ya tiene una cita en ese horario', 409);
  }
  return null;
}
