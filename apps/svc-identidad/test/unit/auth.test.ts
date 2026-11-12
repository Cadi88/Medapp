import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, test } from 'vitest';
import { createAuth } from '../../src/auth.js';

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createAuth', () => {
  const auth = createAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], twoFactor: [] }),
    secret: 'x'.repeat(40),
    baseURL: 'http://localhost:3000',
  });

  test('los usuarios creados reciben ids UUIDv7', async () => {
    const r = await auth.api.signUpEmail({ body: { name: 'Ana', email: 'ana@ejemplo.mx', password: 'una-clave-larga' } });
    expect(r.user.id).toMatch(UUIDV7);
  });

  test('normaliza el email a minúsculas', async () => {
    const r = await auth.api.signUpEmail({ body: { name: 'Beto', email: 'Beto@Ejemplo.MX', password: 'una-clave-larga' } });
    expect(r.user.email).toBe('beto@ejemplo.mx');
  });

  test('exige contraseña de al menos 10 caracteres', async () => {
    await expect(auth.api.signUpEmail({ body: { name: 'C', email: 'c@ejemplo.mx', password: '123456789' } })).rejects.toThrow();
  });

  test('sirve rutas de 2FA (plugin twoFactor) bajo /auth', async () => {
    const res = await auth.handler(new Request('http://localhost:3000/auth/two-factor/verify-totp', { method: 'POST' }));
    expect(res.status).not.toBe(404);
  });
});

describe('createAuth · trustedOrigins', () => {
  const crear = (trustedOrigins?: string[]) =>
    createAuth({
      database: memoryAdapter({ user: [], session: [], account: [], verification: [], twoFactor: [] }),
      secret: 'x'.repeat(40),
      baseURL: 'http://localhost:8080',
      ...(trustedOrigins ? { trustedOrigins } : {}),
    });
  // En pruebas Better Auth desactiva la verificación de Origin; se comprueba la lista que usaría en producción.
  const confiables = async (auth: ReturnType<typeof crear>) => (await auth.$context).trustedOrigins;

  test('los orígenes dados se agregan a los confiables, además del baseURL', async () => {
    const lista = await confiables(crear(['http://localhost:3000']));
    expect(lista).toContain('http://localhost:3000');
    expect(lista).toContain('http://localhost:8080');
  });

  test('sin la opción (o vacía) solo es confiable el baseURL', async () => {
    for (const auth of [crear(), crear([])]) {
      const lista = await confiables(auth);
      expect(lista).not.toContain('http://localhost:3000');
      expect(lista).toContain('http://localhost:8080');
    }
  });
});
