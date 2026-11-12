import { apiErrorSchema, type ApiError } from '@consultorio/contracts';

/**
 * Resultado de una llamada al gateway. Los errores esperados viajan como valor (no como excepción).
 * `setCookies`: las cookies que devolvió Better Auth (solo con `auth: 'sesion' | 'ninguna'`).
 */
export type Resultado<T> =
  | { ok: true; datos: T; setCookies?: string[] }
  | { ok: false; status: number; error: ApiError; setCookies?: string[] };

export function exito<T>(datos: T, setCookies?: string[]): Resultado<T> {
  return setCookies ? { ok: true, datos, setCookies } : { ok: true, datos };
}

export function fallo<T = never>(status: number, error: ApiError, setCookies?: string[]): Resultado<T> {
  return setCookies ? { ok: false, status, error, setCookies } : { ok: false, status, error };
}

/**
 * Error de una respuesta no exitosa. Si no trae el formato único `{ code, message }` (p. ej. errores propios
 * de Better Auth o del proxy), se reduce a un código conocido sin exponer detalles internos.
 */
export function errorDeRespuesta(status: number, cuerpo: unknown): ApiError {
  const e = apiErrorSchema.safeParse(cuerpo);
  if (e.success) return e.data;
  return status === 401
    ? { code: 'NO_AUTENTICADO', message: 'No autenticado' }
    : { code: 'INTERNO', message: 'Error inesperado del servidor' };
}
