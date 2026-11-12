import type { createAuthMiddleware } from 'better-auth/api';
import { getSessionFromCtx } from 'better-auth/api';

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** Endpoints que pueden dejar `twoFactorEnabled = true` (verify-totp al completar el alta; enable si se omitiera la verificación). */
const RUTAS_ALTA_MFA = new Set(['/two-factor/verify-totp', '/two-factor/enable']);

/** Decisión pura: ¿hay que revocar las demás sesiones? Solo si el 2FA pasó de apagado a encendido. */
export function debeRevocarOtras(i: { antes: boolean; despues: boolean }): boolean {
  return !i.antes && i.despues;
}

/**
 * Una sesión abierta solo con contraseña antes del alta de MFA no debe sobrevivir a ella:
 * al activarse el 2FA se revocan TODAS las demás sesiones del usuario (se conserva la actual).
 * El estado previo se guarda por petición (WeakMap sobre `Request`) en el hook `before`.
 */
export function hooksRevocarAlActivarMfa() {
  const previo = new WeakMap<Request, { usuarioId: string; token: string; twoFactor: boolean }>();

  const antes = async (ctx: HookCtx): Promise<void> => {
    if (!RUTAS_ALTA_MFA.has(ctx.path) || !ctx.request) return;
    const s = await getSessionFromCtx(ctx).catch(() => null);
    if (!s) return;
    previo.set(ctx.request, {
      usuarioId: s.user.id,
      token: s.session.token,
      twoFactor: (s.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
    });
  };

  const despues = async (ctx: HookCtx): Promise<void> => {
    if (!RUTAS_ALTA_MFA.has(ctx.path) || !ctx.request) return;
    const p = previo.get(ctx.request);
    if (!p) return;
    previo.delete(ctx.request);
    const usuario = await ctx.context.internalAdapter.findUserById(p.usuarioId);
    const activo = (usuario as { twoFactorEnabled?: boolean | null } | null)?.twoFactorEnabled === true;
    if (!debeRevocarOtras({ antes: p.twoFactor, despues: activo })) return;
    // La sesión vigente tras el alta es la recién emitida (verify-totp reemplaza la actual) o, si no hubo reemplazo, la misma.
    const conservar = ctx.context.newSession?.session.token ?? p.token;
    const sesiones = await ctx.context.internalAdapter.listSessions(p.usuarioId);
    const otras = sesiones.map((x) => x.token).filter((t) => t !== conservar);
    if (otras.length > 0) await ctx.context.internalAdapter.deleteSessions(otras);
  };

  return { antes, despues };
}

type Adaptador = HookCtx['context']['internalAdapter'];

/** Revoca las sesiones del usuario (todas, o todas menos `conservar`). */
export async function revocarSesiones(adapter: Pick<Adaptador, 'listSessions' | 'deleteSessions'>, usuarioId: string, conservar?: string): Promise<void> {
  const tokens = (await adapter.listSessions(usuarioId)).map((s) => s.token).filter((t) => t !== conservar);
  if (tokens.length > 0) await adapter.deleteSessions(tokens);
}

/**
 * Tras un `/change-password` exitoso: baja la bandera de contraseña temporal y revoca las otras sesiones
 * (se conserva la vigente, que puede ser la recién emitida). Si la respuesta fue un error no hace nada.
 */
export async function despuesDeCambiarPassword(ctx: HookCtx): Promise<void> {
  if (ctx.path !== '/change-password') return;
  if ((ctx.context.returned as unknown) instanceof Error) return;
  const s = ctx.context.session;
  if (!s) return;
  await ctx.context.internalAdapter.updateUser(s.user.id, { debeCambiarPassword: false });
  await revocarSesiones(ctx.context.internalAdapter, s.user.id, ctx.context.newSession?.session.token ?? s.session.token);
}
