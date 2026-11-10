import { jetstream } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { ensureStreams } from '@consultorio/platform';
import { startNats, type TestNats } from '@consultorio/platform/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { limpiar, prepararBase, registro, servidor, type Entorno } from './helpers.js';

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let env: Entorno;
let app: FastifyInstance;
const post = (payload: unknown) => app.inject({ method: 'POST', url: '/registro', payload: payload as object });
const registrar = async (slug: string, email?: string) => {
  const r = await post(registro(slug, email));
  expect(r.statusCode).toBe(201);
  return r.json<{ tenantId: string; usuarioId: string }>();
};
const q = async (sql: string, params: unknown[] = []) => (await env.migrator.query(sql, params)).rows;

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
});
afterAll(async () => {
  await app.close();
  await env.stop();
});
beforeEach(() => limpiar(env.migrator));

describe('POST /registro', () => {
  test('crea tenant, admin, membresía y emite eventos', async () => {
    const r = await post(registro('uno'));
    expect(r.statusCode).toBe(201);
    const { tenantId, usuarioId } = r.json();
    expect(tenantId).toMatch(UUIDV7);
    expect(usuarioId).toMatch(UUIDV7);
    expect(r.headers['x-trace-id']).toBeTruthy();

    const tipos = (await q('select type from outbox order by event_id')).map((x) => x.type);
    expect(tipos).toEqual(['tenant.creado', 'usuario.vinculado']);
    const eventos = await q('select payload, tenant_id from outbox order by event_id');
    expect(eventos.every((e) => e.tenant_id === tenantId)).toBe(true);
    expect(eventos[0].payload.data).toMatchObject({ tenantId, slug: 'uno', adminUsuarioId: usuarioId });
    expect(eventos[0].payload.trace_id).toBe(r.headers['x-trace-id']);
    expect(eventos[1].payload.data).toEqual({ usuarioId, rol: 'admin' });

    const [t] = await q('select * from tenant where id = $1', [tenantId]);
    expect(t).toMatchObject({ nombre: 'Consultorio uno', slug: 'uno', zona_horaria: 'America/Mexico_City', plan: 'piloto', estado_suscripcion: 'piloto' });
    const m = await q('select usuario_id, rol from membresia where tenant_id = $1', [tenantId]);
    expect(m).toEqual([{ usuario_id: usuarioId, rol: 'admin' }]);
    const [u] = await q('select id, email, "twoFactorEnabled" from "user" where id = $1', [usuarioId]);
    expect(u.email).toBe('uno@ejemplo.mx');
    expect(u.twoFactorEnabled).toBeFalsy();
  });

  test('normaliza el email a minúsculas y la contraseña queda hasheada', async () => {
    const r = await post(registro('mayus', 'Admin@Ejemplo.MX'));
    expect(r.statusCode).toBe(201);
    expect(await q(`select 1 from "user" where email = 'admin@ejemplo.mx'`)).toHaveLength(1);
    const [a] = await q('select password from account where "userId" = $1', [r.json().usuarioId]);
    expect(a.password).not.toContain('clave-de-prueba-123');
    expect(a.password.length).toBeGreaterThan(40);
  });

  test('el registro no abre sesión (no hay cookies de sesión)', async () => {
    const r = await post(registro('sinsesion'));
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(await q('select 1 from session')).toHaveLength(0);
  });

  test('Review Focus 3: slug repetido → 409 y sin usuario huérfano', async () => {
    await registrar('uno', 'a@x.mx');
    const r = await post(registro('uno', 'b@x.mx'));
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('CONFLICTO');
    expect(await q(`select 1 from "user" where email='b@x.mx'`)).toHaveLength(0);
  });

  test('Review Focus 3: email repetido → 409 y sin tenant creado', async () => {
    await registrar('uno', 'a@x.mx');
    const r = await post(registro('dos', 'a@x.mx'));
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('CONFLICTO');
    expect(await q(`select 1 from tenant where slug='dos'`)).toHaveLength(0);
  });

  test('email repetido con otra capitalización también es 409', async () => {
    await registrar('uno', 'a@x.mx');
    expect((await post(registro('dos', 'A@X.MX'))).statusCode).toBe(409);
  });

  test('Review Focus 3: dos registros simultáneos con el mismo slug → un 201, un 409 y sin huérfanos', async () => {
    for (let i = 0; i < 5; i++) {
      await limpiar(env.migrator);
      const slug = `carrera-${i}`;
      const [a, b] = await Promise.all([post(registro(slug, `a${i}@x.mx`)), post(registro(slug, `b${i}@x.mx`))]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
      expect([a, b].find((x) => x.statusCode === 409)?.json().code).toBe('CONFLICTO');
      expect(await q('select 1 from tenant')).toHaveLength(1);
      expect(await q('select 1 from "user"')).toHaveLength(1);
      expect(await q('select 1 from account')).toHaveLength(1);
      expect(await q('select 1 from membresia')).toHaveLength(1);
      expect(await q('select 1 from outbox')).toHaveLength(2);
    }
  });

  test('dos registros simultáneos con el mismo email → un 201, un 409 y un solo tenant', async () => {
    const [a, b] = await Promise.all([post(registro('uno', 'mismo@x.mx')), post(registro('dos', 'mismo@x.mx'))]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await q('select 1 from tenant')).toHaveLength(1);
    expect(await q('select 1 from "user"')).toHaveLength(1);
  });

  test('si la transacción del tenant falla, se borra el usuario creado y se responde 500 sin detalles', async () => {
    await env.migrator.query(`create or replace function _falla() returns trigger language plpgsql as $$ begin raise exception 'boom interno'; end $$`);
    await env.migrator.query('create trigger _falla_membresia before insert on membresia for each row execute function _falla()');
    try {
      const r = await post(registro('uno', 'a@x.mx'));
      expect(r.statusCode).toBe(500);
      expect(r.json()).toEqual({ code: 'INTERNO', message: 'Error interno' });
      expect(await q(`select 1 from "user" where email='a@x.mx'`)).toHaveLength(0);
      expect(await q('select 1 from account')).toHaveLength(0);
      expect(await q('select 1 from tenant')).toHaveLength(0);
      expect(await q('select 1 from outbox')).toHaveLength(0);
    } finally {
      await env.migrator.query('drop trigger _falla_membresia on membresia');
    }
  });

  test.each([
    ['zona inválida', { zonaHoraria: 'Mars/Base' }],
    ['slug con mayúsculas', { slug: 'Uno' }],
    ['password corta', { admin: { nombre: 'A', email: 'a@x.mx', password: '123' } }],
    ['email inválido', { admin: { nombre: 'A', email: 'nope', password: 'clave-de-prueba-123' } }],
  ])('%s → 400 VALIDACION y no crea nada', async (_n, cambio) => {
    const r = await post({ ...registro('valido'), ...cambio });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('VALIDACION');
    expect(JSON.stringify(r.json())).not.toContain('clave-de-prueba-123');
    expect(await q('select 1 from "user"')).toHaveLength(0);
    expect(await q('select 1 from tenant')).toHaveLength(0);
  });

  test('cuerpo ausente o no JSON → 400 VALIDACION', async () => {
    expect((await app.inject({ method: 'POST', url: '/registro' })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/registro', payload: '{no-json', headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('VALIDACION');
  });
});

describe('servidor', () => {
  test('rutas no públicas exigen token (401 NO_AUTENTICADO)', async () => {
    const r = await app.inject({ method: 'GET', url: '/lo-que-sea' });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('NO_AUTENTICADO');
  });

  test('Better Auth responde bajo /auth sin token: sign-in con credenciales del registro', async () => {
    await registrar('uno', 'a@x.mx');
    const r = await app.inject({
      method: 'POST',
      url: '/auth/sign-in/email',
      payload: { email: 'a@x.mx', password: 'clave-de-prueba-123' },
      headers: { origin: 'http://localhost:3000' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.email).toBe('a@x.mx');
    expect(r.headers['set-cookie']).toBeTruthy();
  });

  test('Better Auth: contraseña errónea → 401 sin token de tenant', async () => {
    await registrar('uno', 'a@x.mx');
    const r = await app.inject({
      method: 'POST',
      url: '/auth/sign-in/email',
      payload: { email: 'a@x.mx', password: 'otra-clave-distinta' },
      headers: { origin: 'http://localhost:3000' },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('publicación de eventos', () => {
  let nats: TestNats;
  let nc: NatsConnection;
  let appNats: FastifyInstance;

  beforeAll(async () => {
    nats = await startNats();
    nc = await connect({ servers: nats.url });
    await ensureStreams(nc);
    appNats = await servidor(env, nc);
  });
  afterAll(async () => {
    await appNats.close();
    await nc.drain();
    await nats.stop();
  });

  test('los eventos del registro llegan a JetStream (evt.tenant.creado y evt.usuario.vinculado)', async () => {
    const r = await appNats.inject({ method: 'POST', url: '/registro', payload: registro('con-nats') });
    expect(r.statusCode).toBe(201);
    const js = jetstream(nc);
    for (const tipo of ['tenant.creado', 'usuario.vinculado']) {
      const c = await js.consumers.get('EVENTOS', { filter_subjects: [`evt.${tipo}`] });
      const m = await c.next({ expires: 10_000 });
      expect(m?.json<{ tenant_id: string }>().tenant_id).toBe(r.json().tenantId);
    }
    const pendientes = await q('select count(*)::int c from outbox where publicado_en is null');
    expect(pendientes[0].c).toBe(0);
  });
});
