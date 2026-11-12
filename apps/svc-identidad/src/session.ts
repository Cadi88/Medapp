import { AppError } from '@consultorio/platform';
import type { FastifyRequest } from 'fastify';
import type { Auth } from './auth.js';

export interface SesionUsuario {
  usuarioId: string;
  twoFactorEnabled: boolean;
  debeCambiarPassword: boolean;
}

function aHeaders(req: FastifyRequest): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  return h;
}

/**
 * Sesión de Better Auth de la petición (cookie). Estas rutas son públicas a nivel del plugin JWT
 * porque aún no hay tenant: se autentican aquí. Sin sesión válida → 401 NO_AUTENTICADO.
 * Better Auth lee usuario y sesión de la BD en cada llamada (sin caché de cookie).
 */
export async function requerirSesion(auth: Pick<Auth, 'api'>, req: FastifyRequest): Promise<SesionUsuario> {
  const s = await auth.api.getSession({ headers: aHeaders(req) });
  if (!s) throw new AppError('NO_AUTENTICADO', 'No autenticado', 401);
  const u = s.user as { twoFactorEnabled?: boolean | null; debeCambiarPassword?: boolean | null };
  return { usuarioId: s.user.id, twoFactorEnabled: u.twoFactorEnabled === true, debeCambiarPassword: u.debeCambiarPassword === true };
}
