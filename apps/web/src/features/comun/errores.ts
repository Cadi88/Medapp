import { redirect } from 'next/navigation';
import type { Resultado } from '@/lib/api/resultado';
import { destinoPorError } from '@/lib/sesion/desvios';
import type { EstadoFormulario } from '@/features/sesion/tipos';

export type Fallo = Extract<Resultado<unknown>, { ok: false }>;

const GENERICO = 'Ocurrió un error. Intenta de nuevo.';

const MENSAJES: Record<string, string> = {
  VALIDACION: 'Revisa los datos del formulario',
  NO_ENCONTRADO: 'El registro ya no existe',
  PROHIBIDO: 'No tienes acceso',
};

/**
 * Error de la API como estado de formulario. Sesión vencida, contraseña temporal o falta de permiso desvían a su
 * pantalla; el resto se muestra como texto. `especificos`: textos propios de la pantalla por código de error.
 */
export function estadoDeFallo(r: Fallo, especificos: Record<string, string> = {}): EstadoFormulario {
  const destino = destinoPorError(r.error, r.status);
  if (destino) redirect(destino);
  if (r.status === 429) return { mensaje: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' };
  return { mensaje: especificos[r.error.code] ?? MENSAJES[r.error.code] ?? GENERICO };
}

/** Datos o desvío (sesión vencida, sin acceso…); cualquier otro error va a la frontera de error con reintento. */
export function datosOFalla<T>(r: Resultado<T>, que: string): T {
  if (r.ok) return r.datos;
  const destino = destinoPorError(r.error, r.status);
  if (destino) redirect(destino);
  throw new Error(`No se pudo cargar ${que} (${r.status})`);
}
