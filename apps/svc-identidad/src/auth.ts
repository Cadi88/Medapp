import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { uuidv7 } from 'uuidv7';
import { hooksRevocarAlActivarMfa } from './revocar-sesiones.js';
import { esAltaDirecta } from './sign-up-guard.js';

export interface AuthOptions {
  /** Pool de `pg` (producción) o adaptador de Better Auth (pruebas unitarias). */
  database: BetterAuthOptions['database'];
  secret: string;
  baseURL: string;
}

/**
 * Better Auth con email+contraseña y TOTP (plugin twoFactor), montado bajo `/auth`.
 * Los ids de usuario/sesión/cuenta son UUIDv7: los tokens exigen `sub` UUID y `membresia.usuario_id`
 * referencia `"user".id` con FK real (columnas `uuid`), por eso se sustituye el generador de ids.
 * No hay auto-inicio de sesión al registrarse: `/registro` crea la cuenta y el usuario inicia sesión después.
 */
export function createAuth(o: AuthOptions) {
  const mfa = hooksRevocarAlActivarMfa();
  return betterAuth({
    appName: 'Consultorio',
    database: o.database,
    secret: o.secret,
    baseURL: o.baseURL,
    basePath: '/auth',
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: false },
    advanced: { database: { generateId: () => uuidv7() } },
    // Alta directa por HTTP cerrada (el alta pasa por /registro, que es atómico y emite eventos).
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (esAltaDirecta(ctx.path, ctx.request !== undefined)) throw new APIError('NOT_FOUND', { message: 'Not found' });
        await mfa.antes(ctx);
      }),
      // Al activarse el 2FA se revocan las demás sesiones (solo contraseña) del usuario.
      after: createAuthMiddleware(async (ctx) => {
        await mfa.despues(ctx);
      }),
    },
    plugins: [twoFactor({ issuer: 'Consultorio' })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
