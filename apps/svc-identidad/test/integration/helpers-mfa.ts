import type { FastifyInstance } from 'fastify';
import {
  ORIGEN,
  PASSWORD,
  activarTotpEIniciarSesion,
  agregarMiembro,
  mezclarCookies,
  pedirToken,
  type Consultorio,
} from './helpers.js';

/** Sign-in solo con contrasena de un usuario con 2FA activo: devuelve las cookies (solo el desafio 2FA, sin sesion). */
export async function iniciarSesionSoloPassword(app: FastifyInstance, email: string, password = PASSWORD): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password }, headers: { origin: ORIGEN } });
  if (r.statusCode !== 200) throw new Error(`sign-in fallo: ${r.statusCode}`);
  return mezclarCookies('', r);
}

/** Alta de un médico con permiso admin, con TOTP activo y su token de tenant. */
export async function crearAdminConToken(app: FastifyInstance, c: Consultorio, email: string): Promise<{ id: string; token: string }> {
  const id = await agregarMiembro(app, c, email, 'medico', true);
  const { cookie } = await activarTotpEIniciarSesion(app, email);
  const r = await pedirToken(app, cookie, c.tenantId);
  if (r.statusCode !== 200) throw new Error(`token fallo: ${r.statusCode}`);
  return { id, token: r.json<{ token: string }>().token };
}
