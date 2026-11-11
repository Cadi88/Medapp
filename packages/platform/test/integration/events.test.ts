import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import type { EventEnvelope } from '@consultorio/contracts';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  consumeEvents,
  createPool,
  enqueueEvent,
  ensureStreams,
  outboxInboxSql,
  runMigrations,
  startOutboxPublisher,
  uuidv7,
  withTenant,
} from '../../src/index.js';
import { startNats, startPostgres } from '../../src/testing/index.js';

let pgh: Awaited<ReturnType<typeof startPostgres>>;
let nats: Awaited<ReturnType<typeof startNats>>;
let app: pg.Pool;
let migrator: pg.Pool;
let nc: NatsConnection;
let dir: string;
const A = uuidv7();
const stoppers: Array<() => Promise<void>> = [];

function evento(type = 'tenant.creado', tenantId = A): EventEnvelope {
  return {
    event_id: uuidv7(),
    type,
    version: 1,
    tenant_id: tenantId,
    actor_id: null,
    occurred_at: new Date().toISOString(),
    trace_id: '0af7651916cd43dd8448eb211c80319c',
    data: { n: 1 },
  };
}

const pendientes = async () => (await migrator.query('select count(*)::int c from outbox where publicado_en is null and descartado_en is null')).rows[0].c as number;

async function siguienteMensaje(stream: string, subject: string) {
  const js = jetstream(nc);
  const c = await js.consumers.get(stream, { filter_subjects: [subject] });
  const m = await c.next({ expires: 10_000 });
  if (!m) throw new Error(`sin mensaje en ${subject}`);
  return { get json() { return m.json<EventEnvelope>(); }, headers: m.headers, subject: m.subject };
}

function publicador(extra: Partial<Parameters<typeof startOutboxPublisher>[0]> = {}) {
  const p = startOutboxPublisher({ pool: app, nc, intervalMs: 50, publishTimeoutMs: 1000, ...extra });
  stoppers.push(() => p.stop());
  return p;
}

async function consumidor(o: Partial<Parameters<typeof consumeEvents>[0]> & Pick<Parameters<typeof consumeEvents>[0], 'handler' | 'subjects'>) {
  const nombre = `c-${uuidv7()}`;
  const c = await consumeEvents({ pool: app, nc, consumidor: nombre, backoffMs: () => 10, ...o });
  stoppers.push(() => c.stop());
  return { ...c, nombre };
}

beforeAll(async () => {
  [pgh, nats] = await Promise.all([startPostgres(), startNats()]);
  dir = mkdtempSync(join(tmpdir(), 'events-'));
  writeFileSync(join(dir, '0001_eventos.sql'), outboxInboxSql('test_app'));
  await runMigrations(pgh.migratorUrl, dir);
  app = createPool(pgh.appUrl);
  migrator = createPool(pgh.migratorUrl);
  nc = await connect({ servers: nats.url });
  await ensureStreams(nc);
});

afterAll(async () => {
  await nc?.close();
  await app?.end();
  await migrator?.end();
  await nats?.stop();
  await pgh?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await migrator.query('truncate outbox, inbox');
  const jsm = await jetstreamManager(nc);
  await jsm.streams.purge('EVENTOS');
  await jsm.streams.purge('DLQ');
});

afterEach(async () => {
  await Promise.allSettled(stoppers.splice(0).map((s) => s()));
});

describe('outbox', () => {
  test('el evento solo existe si la transacción hace commit', async () => {
    await expect(
      withTenant(app, A, async (tx) => {
        await enqueueEvent(tx, evento());
        throw new Error('x');
      }),
    ).rejects.toThrow();
    expect((await migrator.query('select count(*)::int c from outbox')).rows[0].c).toBe(0);
  });

  test('el publicador entrega a evt.<type> con Nats-Msg-Id y traceparent, y marca publicado_en', async () => {
    const e = evento('tenant.creado');
    await withTenant(app, A, (tx) => enqueueEvent(tx, e));
    publicador();
    const recibido = await siguienteMensaje('EVENTOS', 'evt.tenant.creado');
    expect(recibido.json.tenant_id).toBe(A);
    expect(recibido.json.event_id).toBe(e.event_id);
    expect(recibido.headers?.get('Nats-Msg-Id')).toBe(e.event_id);
    expect(recibido.headers?.get('traceparent')).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
    await vi.waitFor(async () => expect(await pendientes()).toBe(0), { timeout: 10_000 });
  });

  test('Review Focus 4: con NATS caído la escritura funciona y el evento sale al volver', async () => {
    publicador();
    await nats.pause();
    try {
      await withTenant(app, A, (tx) => enqueueEvent(tx, evento('tenant.pausa')));
      expect(await pendientes()).toBe(1);
    } finally {
      await nats.unpause();
    }
    await vi.waitFor(async () => expect(await pendientes()).toBe(0), { timeout: 30_000 });
    expect((await siguienteMensaje('EVENTOS', 'evt.tenant.pausa')).json.type).toBe('tenant.pausa');
  });

  test('dos publicadores concurrentes envían cada evento exactamente una vez', async () => {
    const N = 60;
    for (let i = 0; i < N; i++) await withTenant(app, A, (tx) => enqueueEvent(tx, evento('tenant.masivo')));
    const enviados: string[] = [];
    const onPublicado = (id: string) => enviados.push(id);
    publicador({ lote: 7, onPublicado });
    publicador({ lote: 7, onPublicado });
    await vi.waitFor(async () => expect(await pendientes()).toBe(0), { timeout: 30_000 });
    expect(enviados).toHaveLength(N);
    expect(new Set(enviados).size).toBe(N);
    const info = await (await jetstreamManager(nc)).streams.info('EVENTOS');
    expect(info.state.messages).toBe(N);
  });
});

describe('robustez', () => {
  const insertarCrudo = (id: string, type: string, payload: unknown) =>
    migrator.query(
      "insert into outbox (event_id, tenant_id, type, payload, creado_en) values ($1,$2,$3,$4::jsonb, now() - interval '1 minute')",
      [id, A, type, JSON.stringify(payload)],
    );

  test('filas inválidas (type no seguro, payload gigante) se descartan y no bloquean a las de atrás', async () => {
    const malo1 = uuidv7();
    const malo2 = uuidv7();
    await insertarCrudo(malo1, 'tipo con espacios', { trace_id: 'x' });
    await insertarCrudo(malo2, 'tenant.gigante', { trace_id: 'x', data: 'x'.repeat(2 * 1024 * 1024) });
    const bueno = evento('tenant.bueno');
    await withTenant(app, A, (tx) => enqueueEvent(tx, bueno));
    const errores: unknown[] = [];
    publicador({ onError: (e) => errores.push(e) });
    expect((await siguienteMensaje('EVENTOS', 'evt.tenant.bueno')).json.event_id).toBe(bueno.event_id);
    await vi.waitFor(async () => expect(await pendientes()).toBe(0), { timeout: 10_000 });
    const filas = (await migrator.query('select event_id, error, descartado_en, publicado_en from outbox where event_id = any($1)', [[malo1, malo2]])).rows;
    expect(filas).toHaveLength(2);
    for (const f of filas) {
      expect(f.descartado_en).not.toBeNull();
      expect(f.publicado_en).toBeNull();
      expect(f.error).toBeTruthy();
    }
    expect(errores.length).toBeGreaterThanOrEqual(2);
  });
});

describe('consumidor', () => {
  const publicarCrudo = async (subject: string, payload: string) => {
    await jetstream(nc).publish(subject, payload);
  };

  test('un evento entregado dos veces se procesa una sola vez', async () => {
    const handler = vi.fn(async () => {});
    const { nombre } = await consumidor({ subjects: ['evt.tenant.doble'], handler });
    const e = evento('tenant.doble');
    await publicarCrudo('evt.tenant.doble', JSON.stringify(e));
    await publicarCrudo('evt.tenant.doble', JSON.stringify(e));
    await vi.waitFor(async () => {
      const info = await (await jetstreamManager(nc)).consumers.info('EVENTOS', nombre);
      expect(info.num_pending + info.num_ack_pending).toBe(0);
      expect(info.delivered.consumer_seq).toBeGreaterThanOrEqual(2);
    }, { timeout: 10_000 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await migrator.query('select count(*)::int c from inbox')).rows[0].c).toBe(1);
  });

  test('el handler recibe tx con el tenant y un logger con bindings del evento', async () => {
    const vistos: unknown[] = [];
    const handler = vi.fn(async (e: EventEnvelope, tx: pg.PoolClient, ctx: { logger: { bindings(): Record<string, unknown> } }) => {
      vistos.push((await tx.query("select current_setting('app.tenant_id', true) t")).rows[0].t, ctx.logger.bindings());
      expect(e.type).toBe('tenant.ctx');
    });
    await consumidor({ subjects: ['evt.tenant.ctx'], handler });
    const e = evento('tenant.ctx');
    await publicarCrudo('evt.tenant.ctx', JSON.stringify(e));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(vistos[0]).toBe(A);
    expect(vistos[1]).toMatchObject({ tenant_id: A, trace_id: e.trace_id, event_id: e.event_id, type: 'tenant.ctx' });
  });

  test('tras 5 fallos el mensaje va a dlq.<type> con el payload original', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    await consumidor({ subjects: ['evt.tenant.falla'], handler });
    const e = evento('tenant.falla');
    await publicarCrudo('evt.tenant.falla', JSON.stringify(e));
    const dlq = await siguienteMensaje('DLQ', 'dlq.tenant.falla');
    expect(dlq.json).toEqual(e);
    expect(dlq.headers?.get('x-error')).toBe('boom');
    expect(dlq.headers?.get('x-entregas')).toBe('5');
    expect(handler).toHaveBeenCalledTimes(5);
    expect((await migrator.query('select count(*)::int c from inbox')).rows[0].c).toBe(0);
  });

  test('F1: con Postgres caído (pausado > 20 s) el evento no va a la DLQ y se procesa al volver', async () => {
    // Pool nuevo, sin conexiones ociosas: cada intento abre una conexión y choca con el timeout de connect (5 s).
    const pool = createPool(pgh.appUrl);
    stoppers.push(() => pool.end());
    const handler = vi.fn(async () => {});
    // maxEntregas 3: antes del arreglo, 3 timeouts de connect (~15 s) bastaban para mandarlo a la DLQ.
    const { nombre } = await consumidor({ pool, subjects: ['evt.tenant.bdcaida'], handler, maxEntregas: 3, backoffInfraMs: () => 500 });
    const e = evento('tenant.bdcaida');
    await pgh.pause();
    try {
      await publicarCrudo('evt.tenant.bdcaida', JSON.stringify(e));
      await new Promise((r) => setTimeout(r, 22_000));
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await pgh.unpause();
    }
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    await vi.waitFor(async () => {
      const info = await (await jetstreamManager(nc)).consumers.info('EVENTOS', nombre);
      expect(info.num_pending + info.num_ack_pending).toBe(0);
    }, { timeout: 10_000 });
    expect((await (await jetstreamManager(nc)).streams.info('DLQ')).state.messages).toBe(0);
    expect((await migrator.query('select count(*)::int c from inbox where event_id = $1', [e.event_id])).rows[0].c).toBe(1);
  }, 120_000);

  test('F1: un error de infraestructura va a la DLQ solo al agotar el presupuesto de tiempo (no por entregas)', async () => {
    const caida = createPool('postgres://nadie:x@127.0.0.1:1/nada', { connectionTimeoutMillis: 1000 });
    stoppers.push(() => caida.end());
    const handler = vi.fn(async () => {});
    await consumidor({ pool: caida, subjects: ['evt.tenant.sinbd'], handler, maxEntregas: 100, presupuestoInfraMs: 0 });
    const e = evento('tenant.sinbd');
    await publicarCrudo('evt.tenant.sinbd', JSON.stringify(e));
    const dlq = await siguienteMensaje('DLQ', 'dlq.tenant.sinbd');
    expect(dlq.json).toEqual(e);
    expect(dlq.headers?.get('x-entregas')).toBe('1');
    expect(handler).not.toHaveBeenCalled();
  });

  test('reiniciar un consumidor con subjects distintos lo actualiza y recibe el nuevo subject', async () => {
    const nombre = `c-${uuidv7()}`;
    const h1 = vi.fn(async () => {});
    const c1 = await consumeEvents({ pool: app, nc, consumidor: nombre, subjects: ['evt.tenant.a1'], handler: h1, backoffMs: () => 10 });
    await c1.stop();
    const h2 = vi.fn(async () => {});
    const c2 = await consumeEvents({ pool: app, nc, consumidor: nombre, subjects: ['evt.tenant.a1', 'evt.tenant.a2'], handler: h2, backoffMs: () => 10 });
    stoppers.push(() => c2.stop());
    await publicarCrudo('evt.tenant.a2', JSON.stringify(evento('tenant.a2')));
    await vi.waitFor(() => expect(h2).toHaveBeenCalledTimes(1), { timeout: 10_000 });
  });

  test('la DLQ distingue por consumidor: dos consumidores fallando el mismo evento dejan dos registros', async () => {
    const fallo = vi.fn().mockRejectedValue(new Error('boom'));
    const c1 = await consumidor({ subjects: ['evt.tenant.dos'], handler: fallo, maxEntregas: 2 });
    const c2 = await consumidor({ subjects: ['evt.tenant.dos'], handler: fallo, maxEntregas: 2 });
    await publicarCrudo('evt.tenant.dos', JSON.stringify(evento('tenant.dos')));
    await vi.waitFor(async () => expect((await (await jetstreamManager(nc)).streams.info('DLQ')).state.messages).toBe(2), { timeout: 15_000 });
    const cons = await jetstream(nc).consumers.get('DLQ', { filter_subjects: ['dlq.tenant.dos'] });
    const nombres = new Set<string | undefined>();
    for (let i = 0; i < 2; i++) nombres.add((await cons.next({ expires: 5000 }))?.headers?.get('x-consumidor'));
    expect(nombres).toEqual(new Set([c1.nombre, c2.nombre]));
  });

  test('un type no seguro como subject va a dlq.invalido tras agotar entregas', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    await consumidor({ subjects: ['evt.tenant.raro'], handler, maxEntregas: 2 });
    await publicarCrudo('evt.tenant.raro', JSON.stringify(evento('tipo con espacios')));
    const dlq = await siguienteMensaje('DLQ', 'dlq.invalido');
    expect(dlq.headers?.get('x-error')).toBe('boom');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('un mensaje envenenado va a dlq.invalido y el consumidor sigue vivo', async () => {
    const handler = vi.fn(async () => {});
    await consumidor({ subjects: ['evt.tenant.veneno'], handler });
    await publicarCrudo('evt.tenant.veneno', 'esto no es json');
    await publicarCrudo('evt.tenant.veneno', JSON.stringify({ type: 'x' }));
    const e = evento('tenant.veneno');
    await publicarCrudo('evt.tenant.veneno', JSON.stringify(e));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const info = await (await jetstreamManager(nc)).streams.info('DLQ');
    expect(info.state.messages).toBe(2);
    expect((await siguienteMensaje('DLQ', 'dlq.invalido')).headers?.get('x-error')).toBeTruthy();
  });
});
