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

const pendientes = async () => (await migrator.query('select count(*)::int c from outbox where publicado_en is null')).rows[0].c as number;

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
