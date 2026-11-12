import { jetstream } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { TenantCreado, UsuarioVinculado } from '@consultorio/contracts';
import { ensureStreams } from '@consultorio/platform';
import { startNats, type TestNats } from '@consultorio/platform/testing';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { iniciarConsumidor } from '../../src/consumidor.js';
import { verificarCadena } from '../../src/verificacion.js';
import { leer, prepararBase, type Entorno } from './helpers.js';

let env: Entorno;
let nats: TestNats;
let nc: NatsConnection;
let consumidor: { stop(): Promise<void> };

beforeAll(async () => {
  [env, nats] = await Promise.all([prepararBase(), startNats()]);
  nc = await connect({ servers: nats.url });
  await ensureStreams(nc);
  consumidor = await iniciarConsumidor({ pool: env.appPool, nc });
});
afterAll(async () => {
  await consumidor.stop();
  await nc.drain();
  await env.stop();
  await nats.stop();
});

const publicar = (e: Record<string, unknown> & { type: string }) => jetstream(nc).publish(`evt.${e.type}`, JSON.stringify(e));

async function esperar<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > fin) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('consumidor de auditoría', () => {
  test('consume tenant.creado desde NATS y lo registra una sola vez aunque llegue duplicado', async () => {
    const T = uuidv7();
    const e = TenantCreado.create({
      tenantId: T,
      actorId: null,
      traceId: 'trace-1',
      data: { tenantId: T, nombre: 'Clínica', slug: 'clinica', zonaHoraria: 'America/Mexico_City', adminUsuarioId: uuidv7() },
    });
    await publicar(e);
    await publicar(e); // duplicado: mismo event_id, sin Nats-Msg-Id → ambos entran al stream
    // Un evento posterior del mismo tenant sirve de barrera: cuando está, los dos anteriores ya se procesaron.
    const barrera = UsuarioVinculado.create({ tenantId: T, actorId: null, traceId: 'trace-2', data: { usuarioId: uuidv7(), nombre: 'Ana', rol: 'medico', admin: false } });
    await publicar(barrera);
    const filas = await esperar(() => leer(env, T), (f) => f.length >= 2);
    expect(filas.map((f) => [f.accion, f.secuencia])).toEqual([
      ['tenant.creado', '1'],
      ['usuario.vinculado', '2'],
    ]);
    expect(filas[0]).toMatchObject({ id: e.event_id, recurso_tipo: 'tenant', recurso_id: T, servicio: 'identidad', actor_id: null });
    expect((await verificarCadena(env.appPool, T)).valida).toBe(true);
  });

  test('eventos de tipos aún desconocidos se registran con servicio "desconocido"', async () => {
    const T = uuidv7();
    await publicar({
      event_id: uuidv7(),
      type: 'cita.agendada',
      version: 1,
      tenant_id: T,
      actor_id: null,
      occurred_at: new Date().toISOString(),
      trace_id: 't',
      data: { citaId: 'c-1' },
    });
    const filas = await esperar(() => leer(env, T), (f) => f.length >= 1);
    expect(filas[0]).toMatchObject({ servicio: 'desconocido', recurso_tipo: 'cita', recurso_id: 'c-1' });
  });
});
