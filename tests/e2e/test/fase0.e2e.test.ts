import { describe, expect, test, vi } from 'vitest';
import { crearConsultorio, peticion, registro, slugUnico } from './cliente.js';

interface Evento {
  accion: string;
  tenant_id?: string;
  tenantId?: string;
}
const listarEventos = async (token: string): Promise<Evento[]> => {
  const r = await peticion<{ eventos: Evento[] }>('GET', '/api/auditoria/eventos', { token });
  expect(r.status).toBe(200);
  return r.cuerpo.eventos;
};

describe('Fase 0 de punta a punta (a través del gateway)', () => {
  test('registro, MFA, token y la auditoría ve el alta del consultorio', async () => {
    const { tenantId, token } = await crearConsultorio(slugUnico('e2e-uno'));
    expect(tenantId).toMatch(/^[0-9a-f-]{36}$/);
    await vi.waitFor(
      async () => {
        const eventos = await listarEventos(token);
        expect(eventos.map((e) => e.accion)).toEqual(expect.arrayContaining(['tenant.creado', 'usuario.vinculado']));
      },
      { timeout: 20_000, interval: 500 },
    );
  });

  test('el admin de un consultorio no ve la auditoría de otro', async () => {
    const a = await crearConsultorio(slugUnico('e2e-a'));
    const b = await crearConsultorio(slugUnico('e2e-b'));
    for (const c of [a, b]) {
      await vi.waitFor(
        async () => {
          expect((await listarEventos(c.token)).map((e) => e.accion)).toContain('tenant.creado');
        },
        { timeout: 20_000, interval: 500 },
      );
    }
    for (const propio of [a, b]) {
      const eventos = await listarEventos(propio.token);
      expect(eventos.length).toBeGreaterThan(0);
      const tenants = new Set(eventos.map((e) => e.tenant_id ?? e.tenantId));
      expect([...tenants]).toEqual([propio.tenantId]);
    }
  });

  test('el alta directa por Better Auth no existe a través del gateway (404)', async () => {
    const r = await peticion('POST', '/api/identidad/auth/sign-up/email', {
      cuerpo: { email: `x@${slugUnico('directo')}.mx`, password: 'clave-e2e-segura-123', name: 'X' },
    });
    expect(r.status).toBe(404);
  });

  test('una ruta protegida sin token responde 401', async () => {
    const r = await peticion('GET', '/api/auditoria/eventos');
    expect(r.status).toBe(401);
  });

  test('el registro duplicado devuelve 409 CONFLICTO', async () => {
    const slug = slugUnico('e2e-dup');
    expect((await peticion('POST', '/api/identidad/registro', { cuerpo: registro(slug) })).status).toBe(201);
    const r = await peticion<{ code: string }>('POST', '/api/identidad/registro', { cuerpo: registro(slug) });
    expect(r.status).toBe(409);
    expect(r.cuerpo.code).toBe('CONFLICTO');
  });
});
