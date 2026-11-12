import type { ApiError } from '@consultorio/contracts';

export type Desvio = '/login' | '/cambiar-password' | '/configurar-mfa' | '/sin-acceso';

/** Pantalla a la que se desvía el usuario según el error; `null` = lo maneja la pantalla actual. */
export function destinoPorError(e: ApiError, status: number): Desvio | null {
  if (status === 401 || e.code === 'NO_AUTENTICADO') return '/login';
  switch (e.code) {
    case 'PASSWORD_TEMPORAL':
      return '/cambiar-password';
    case 'MFA_REQUERIDA':
      return '/configurar-mfa';
    case 'PROHIBIDO':
      return '/sin-acceso';
    default:
      return null;
  }
}
