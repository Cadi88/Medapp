import { jetstream } from '@nats-io/jetstream';
import { headers as natsHeaders, type NatsConnection } from '@nats-io/transport-node';
import type { EventEnvelope } from '@consultorio/contracts';
import type pg from 'pg';
import { headersPublicacion, subjectEvento } from './streams.js';

export interface OutboxRow {
  event_id: string;
  tenant_id: string;
  type: string;
  payload: string;
}

/** Fila de outbox para un sobre: el payload es el sobre completo serializado. */
export function envelopeToRow(e: EventEnvelope): OutboxRow {
  return { event_id: e.event_id, tenant_id: e.tenant_id, type: e.type, payload: JSON.stringify(e) };
}

/** Inserta el evento en `outbox` dentro de la transacción del llamador (solo existe si hay commit). */
export async function enqueueEvent(tx: pg.PoolClient, e: EventEnvelope): Promise<void> {
  const r = envelopeToRow(e);
  await tx.query('INSERT INTO outbox (event_id, tenant_id, type, payload) VALUES ($1, $2, $3, $4::jsonb)', [
    r.event_id,
    r.tenant_id,
    r.type,
    r.payload,
  ]);
}

export interface OutboxPublisherOptions {
  pool: pg.Pool;
  nc: NatsConnection;
  intervalMs?: number;
  lote?: number;
  /** Tiempo máximo de espera del ack de JetStream por mensaje. */
  publishTimeoutMs?: number;
  onError?: (err: unknown) => void;
  /** Se invoca por cada evento que JetStream confirmó (métricas / pruebas). */
  onPublicado?: (eventId: string) => void;
}

interface PendingRow {
  event_id: string;
  type: string;
  payload: { trace_id?: unknown };
}

/**
 * Publica filas pendientes del outbox. Cada ciclo es una transacción que bloquea el lote con
 * FOR UPDATE SKIP LOCKED (dos publicadores nunca toman la misma fila) y marca `publicado_en`
 * solo de lo que JetStream confirmó. Si el proceso muere entre publicar y marcar, el reenvío
 * lo descarta JetStream por `Nats-Msg-Id`.
 */
export function startOutboxPublisher(o: OutboxPublisherOptions): { stop(): Promise<void> } {
  const intervalMs = o.intervalMs ?? 500;
  const lote = o.lote ?? 100;
  const timeout = o.publishTimeoutMs ?? 2000;
  const js = jetstream(o.nc);
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let wake: (() => void) | undefined;

  const publicar = async (row: PendingRow): Promise<void> => {
    const h = natsHeaders();
    const traceId = typeof row.payload.trace_id === 'string' ? row.payload.trace_id : '';
    for (const [k, v] of Object.entries(headersPublicacion({ event_id: row.event_id, trace_id: traceId }))) h.set(k, v);
    await js.publish(subjectEvento(row.type), JSON.stringify(row.payload), { msgID: row.event_id, headers: h, timeout });
  };

  /** Devuelve cuántas filas procesó el ciclo (0 si hubo fallo de NATS). */
  const ciclo = async (): Promise<number> => {
    const client = await o.pool.connect();
    let destroy: Error | undefined;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<PendingRow>(
        'SELECT event_id, type, payload FROM outbox WHERE publicado_en IS NULL ORDER BY creado_en, event_id LIMIT $1 FOR UPDATE SKIP LOCKED',
        [lote],
      );
      const hechos: string[] = [];
      let falla: unknown;
      for (const row of rows) {
        try {
          await publicar(row);
          hechos.push(row.event_id);
          o.onPublicado?.(row.event_id);
        } catch (err) {
          falla = err;
          break;
        }
      }
      if (hechos.length > 0) await client.query('UPDATE outbox SET publicado_en = now() WHERE event_id = ANY($1::uuid[])', [hechos]);
      await client.query('COMMIT');
      if (falla) {
        o.onError?.(falla);
        return 0;
      }
      return rows.length;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        destroy = rbErr instanceof Error ? rbErr : new Error(String(rbErr));
      }
      throw err;
    } finally {
      if (destroy) client.release(destroy);
      else client.release();
    }
  };

  const dormir = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });

  const bucle = (async () => {
    while (!stopped) {
      let n = 0;
      try {
        n = await ciclo();
      } catch (err) {
        o.onError?.(err);
      }
      // Lote lleno: seguir sin esperar; si no, dormir hasta el siguiente ciclo.
      if (!stopped && n < lote) await dormir(intervalMs);
    }
  })();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      wake?.();
      await bucle;
    },
  };
}
