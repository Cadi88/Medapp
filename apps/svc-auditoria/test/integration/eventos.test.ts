import { withTenant } from '@consultorio/platform';
import { startTestJwks, type TestJwks } from '@consultorio/platform/testing';
import type { FastifyInstance } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { registrar } from '../../src/cadena.js';
import { buildServer } from '../../src/server.js';
import { evento, prepararBase, range, registrarN, tenantId, type Entorno } from './helpers.js';

let env: Entorno;
let jwks: TestJwks;
let app: FastifyInstance;
const A = tenantId();
const B = tenantId();

type Perfil = { rol: 'medico' | 'recepcion'; admin: boolean };
const token = (tid: string, p: Perfil) => jwks.sign({ sub: uuidv7(), tid, rol: p.rol, admin: p.admin, mfa: true });
const get = async (url: string, tid = A, perfil: Perfil = { rol: 'medico', admin: true }) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await token(tid, perfil)}` } });

beforeAll(async () => {
  env = await prepararBase();
  jwks = await startTestJwks();
  app = await buildServer({ pool: env.appPool, jwksUrl: jwks.url });
  await app.ready();
  await registrarN(env, A, 5);
  await registrarN(env, B, 2);
});
afterAll(async () => {
  await app.close();
  await jwks.stop();
  await env.stop();
});

describe('GET /eventos', () => {
  test('solo devuelve eventos del tenant del token, con secuencia descendente', async () => {
    const r = await get('/eventos');
    expect(r.statusCode).toBe(200);
    const { eventos } = r.json<{ eventos: { tenant_id: string; secuencia: string }[] }>();
    expect(eventos.map((e) => e.secuencia)).toEqual(['5', '4', '3', '2', '1']);
    expect(new Set(eventos.map((e) => e.tenant_id))).toEqual(new Set([A]));
    const b = await get('/eventos', B);
    expect(b.json<{ eventos: unknown[] }>().eventos).toHaveLength(2);
  });

  test('expone las columnas de auditoría incluido el hash', async () => {
    const [e] = (await get('/eventos?limite=1')).json<{ eventos: Record<string, unknown>[] }>().eventos;
    expect(Object.keys(e!).sort()).toEqual(
      ['accion', 'actor_id', 'detalle', 'hash', 'hash_anterior', 'id', 'ocurrido_en', 'recurso_id', 'recurso_tipo', 'secuencia', 'servicio', 'tenant_id'].sort(),
    );
    expect(e!.secuencia).toBe('5');
  });

  test('exige permiso admin → 403 para medico y recepcion sin admin', async () => {
    for (const rol of ['medico', 'recepcion'] as const) {
      const r = await get('/eventos', A, { rol, admin: false });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({ code: 'PROHIBIDO' });
    }
  });

  test('recepción con permiso admin sí puede leer', async () => {
    expect((await get('/eventos', A, { rol: 'recepcion', admin: true })).statusCode).toBe(200);
  });

  test('sin token → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/eventos' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ code: 'NO_AUTENTICADO' });
  });

  test('limite: por defecto 50, máximo 200, inválido → 400', async () => {
    const C = tenantId();
    await Promise.all(Array.from({ length: 60 }, () => withTenant(env.appPool, C, (tx) => registrar(tx, evento(C)))));
    expect((await get('/eventos', C)).json<{ eventos: unknown[] }>().eventos).toHaveLength(50);
    expect((await get('/eventos?limite=7', C)).json<{ eventos: unknown[] }>().eventos).toHaveLength(7);
    expect((await get('/eventos?limite=200', C)).statusCode).toBe(200);
    for (const l of ['201', '0', 'x', '-3']) {
      const r = await get(`/eventos?limite=${l}`, C);
      expect(r.statusCode, l).toBe(400);
      expect(r.json()).toMatchObject({ code: 'VALIDACION' });
    }
  });

  test('desde/hasta filtran por fecha y deben ser ISO', async () => {
    const D = tenantId();
    for (const iso of ['2026-01-01T10:00:00.000Z', '2026-01-02T10:00:00.000Z', '2026-01-03T10:00:00.000Z']) {
      await withTenant(env.appPool, D, (tx) => registrar(tx, evento(D, { occurred_at: iso })));
    }
    const fechas = async (q: string) => (await get(`/eventos?${q}`, D)).json<{ eventos: { ocurrido_en: string }[] }>().eventos.map((e) => e.ocurrido_en);
    expect(await fechas('desde=2026-01-02T00:00:00Z')).toEqual(['2026-01-03T10:00:00.000Z', '2026-01-02T10:00:00.000Z']);
    expect(await fechas('hasta=2026-01-02T12:00:00Z')).toEqual(['2026-01-02T10:00:00.000Z', '2026-01-01T10:00:00.000Z']);
    expect(await fechas('desde=2026-01-02T00:00:00Z&hasta=2026-01-02T23:00:00Z')).toEqual(['2026-01-02T10:00:00.000Z']);
    expect((await get('/eventos?desde=ayer', D)).statusCode).toBe(400);
    expect((await get('/eventos?desde=2026-02-01T00:00:00Z&hasta=2026-01-01T00:00:00Z', D)).statusCode).toBe(400);
  });

  test('paginar 120 eventos de 50 en 50 los recorre todos sin repetir', async () => {
    const P = tenantId();
    for (let i = 0; i < 120; i += 20) {
      await Promise.all(Array.from({ length: 20 }, () => withTenant(env.appPool, P, (tx) => registrar(tx, evento(P)))));
    }
    type Pagina = { eventos: { secuencia: string }[]; siguiente: number | null };
    const vistas: string[] = [];
    const tamanos: number[] = [];
    let antesDe: number | null = null;
    do {
      const r = await get(`/eventos?limite=50${antesDe === null ? '' : `&antesDe=${antesDe}`}`, P);
      expect(r.statusCode).toBe(200);
      const pagina: Pagina = r.json<Pagina>();
      tamanos.push(pagina.eventos.length);
      vistas.push(...pagina.eventos.map((e) => e.secuencia));
      if (pagina.siguiente !== null) expect(typeof pagina.siguiente).toBe('number');
      antesDe = pagina.siguiente;
    } while (antesDe !== null);
    expect(tamanos).toEqual([50, 50, 20]);
    expect(new Set(vistas).size).toBe(120);
    expect(vistas).toEqual(range(1, 120).reverse().map(String));
  });

  test('siguiente es null si hay menos filas que el límite', async () => {
    expect((await get('/eventos?limite=10')).json()).toMatchObject({ siguiente: null });
    expect((await get('/eventos?limite=5')).json()).toMatchObject({ siguiente: 1 });
  });

  test('filtra por accion exacta y valida el formato', async () => {
    const F = tenantId();
    await withTenant(env.appPool, F, (tx) => registrar(tx, evento(F)));
    await withTenant(env.appPool, F, (tx) => registrar(tx, evento(F)));
    const todos = (await get('/eventos', F)).json<{ eventos: { accion: string }[] }>().eventos;
    const accion = todos[0]!.accion;
    expect((await get(`/eventos?accion=${accion}`, F)).json<{ eventos: unknown[] }>().eventos).toHaveLength(2);
    expect((await get('/eventos?accion=otra.cosa', F)).json<{ eventos: unknown[] }>().eventos).toHaveLength(0);
    for (const q of ['accion=DROP%20TABLE', 'antesDe=-1', 'antesDe=0']) {
      const e = await get(`/eventos?${q}`, F);
      expect(e.statusCode, q).toBe(400);
      expect(e.json()).toMatchObject({ code: 'VALIDACION' });
    }
  });
});
