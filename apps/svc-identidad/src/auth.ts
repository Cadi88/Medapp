import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { uuidv7 } from 'uuidv7';

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
  return betterAuth({
    appName: 'Consultorio',
    database: o.database,
    secret: o.secret,
    baseURL: o.baseURL,
    basePath: '/auth',
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: false },
    advanced: { database: { generateId: () => uuidv7() } },
    plugins: [twoFactor({ issuer: 'Consultorio' })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
