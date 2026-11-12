import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, test } from 'vitest';
import { createAuth } from '../../src/auth.js';
import { puedeReiniciarPassword } from '../../src/dominio/password-temporal.js';
import { decidirToken } from '../../src/dominio/reglas.js';

describe('decidirToken con contraseña temporal', () => {
  test('PASSWORD_TEMPORAL tiene prioridad sobre MFA_REQUERIDA', () => {
    expect(decidirToken({ rol: 'medico', admin: false, twoFactorEnabled: false, debeCambiarPassword: true })).toEqual({
      ok: false,
      motivo: 'PASSWORD_TEMPORAL',
    });
  });
  test('con la bandera activa se niega aunque el MFA esté cumplido o no se exija', () => {
    expect(decidirToken({ rol: 'recepcion', admin: false, twoFactorEnabled: false, debeCambiarPassword: true })).toEqual({
      ok: false,
      motivo: 'PASSWORD_TEMPORAL',
    });
    expect(decidirToken({ rol: 'medico', admin: true, twoFactorEnabled: true, debeCambiarPassword: true })).toEqual({
      ok: false,
      motivo: 'PASSWORD_TEMPORAL',
    });
  });
  test('sin bandera y sin 2FA donde se exige → MFA_REQUERIDA', () => {
    expect(decidirToken({ rol: 'medico', admin: false, twoFactorEnabled: false, debeCambiarPassword: false })).toEqual({
      ok: false,
      motivo: 'MFA_REQUERIDA',
    });
  });
  test('sin bandera y con requisitos cumplidos → ok', () => {
    expect(decidirToken({ rol: 'recepcion', admin: false, twoFactorEnabled: false, debeCambiarPassword: false })).toEqual({ ok: true, mfa: false });
  });
});

describe('puedeReiniciarPassword', () => {
  test.each([
    [{ esMiembro: false, otrosConsultorios: 0 }, 'no_encontrado'],
    [{ esMiembro: false, otrosConsultorios: 2 }, 'no_encontrado'],
    [{ esMiembro: true, otrosConsultorios: 1 }, 'compartida'],
    [{ esMiembro: true, otrosConsultorios: 0 }, 'ok'],
  ] as const)('%o → %s', (i, esperado) => {
    expect(puedeReiniciarPassword(i)).toBe(esperado);
  });
});

describe('hook after de /change-password', () => {
  const auth = createAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], twoFactor: [] }),
    secret: 'x'.repeat(40),
    baseURL: 'http://localhost:3000',
  });
  const ctxPromise = auth.$context;
  const bandera = async (id: string) => {
    const u = (await (await ctxPromise).internalAdapter.findUserById(id)) as unknown as { debeCambiarPassword?: boolean } | null;
    return u?.debeCambiarPassword;
  };

  test('el campo debeCambiarPassword existe, vale false por defecto y no se acepta como entrada', async () => {
    const r = await auth.api.signUpEmail({
      body: { name: 'Ana', email: 'ana@ejemplo.mx', password: 'una-clave-larga', debeCambiarPassword: true } as never,
    });
    expect(await bandera(r.user.id)).toBe(false);
  });

  test('un change-password exitoso baja la bandera y revoca las otras sesiones; uno fallido no', async () => {
    const ctx = await ctxPromise;
    const r = await auth.api.signUpEmail({ body: { name: 'Beto', email: 'beto@ejemplo.mx', password: 'clave-temporal-1' } });
    await ctx.internalAdapter.updateUser(r.user.id, { debeCambiarPassword: true });
    const abrir = async () => {
      const s = await auth.api.signInEmail({ body: { email: 'beto@ejemplo.mx', password: 'clave-temporal-1' }, returnHeaders: true });
      const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      return { headers: new Headers({ cookie }), token: s.response.token };
    };
    const a = await abrir();
    await abrir();
    expect((await ctx.internalAdapter.listSessions(r.user.id)).length).toBe(2);

    await expect(
      auth.api.changePassword({ headers: a.headers, body: { currentPassword: 'incorrecta-123', newPassword: 'clave-nueva-123' } }),
    ).rejects.toThrow();
    expect((await bandera(r.user.id))).toBe(true);
    expect((await ctx.internalAdapter.listSessions(r.user.id)).length).toBe(2);

    await auth.api.changePassword({ headers: a.headers, body: { currentPassword: 'clave-temporal-1', newPassword: 'clave-nueva-123' } });
    expect((await bandera(r.user.id))).toBe(false);
    const quedan = await ctx.internalAdapter.listSessions(r.user.id);
    expect(quedan.map((s) => s.token)).toEqual([a.token]);
  });
});
