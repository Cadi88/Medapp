import { randomBytes } from 'node:crypto';
import { jetstreamManager, RetentionPolicy, StorageType, type JetStreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';

export const STREAM_EVENTOS = 'EVENTOS';
export const STREAM_DLQ = 'DLQ';
const TREINTA_DIAS_NS = 30 * 24 * 3600 * 1e9;

export const subjectEvento = (type: string): string => `evt.${type}`;
export const subjectDlq = (type: string): string => `dlq.${type}`;

const TRACE_ID_RE = /^[0-9a-f]{32}$/;

/** `traceparent` W3C derivado de `trace_id`; solo si es un trace id válido (32 hex, no todo ceros). */
export function traceparentDe(traceId: string): string | undefined {
  if (!TRACE_ID_RE.test(traceId) || /^0+$/.test(traceId)) return undefined;
  return `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
}

/** Cabeceras de publicación: `Nats-Msg-Id` (dedupe de JetStream) y, si procede, `traceparent`. */
export function headersPublicacion(e: { event_id: string; trace_id: string }): Record<string, string> {
  const h: Record<string, string> = { 'Nats-Msg-Id': e.event_id };
  const tp = traceparentDe(e.trace_id);
  if (tp) h['traceparent'] = tp;
  return h;
}

async function upsertStream(jsm: JetStreamManager, cfg: { name: string; subjects: string[]; max_age: number }): Promise<void> {
  const full = { ...cfg, retention: RetentionPolicy.Limits, storage: StorageType.File };
  try {
    await jsm.streams.info(cfg.name);
  } catch (err) {
    if (/not found/i.test(String((err as Error).message))) {
      await jsm.streams.add(full);
      return;
    }
    throw err;
  }
  await jsm.streams.update(cfg.name, full);
}

/** Asegura los streams EVENTOS (`evt.>`, 30 días) y DLQ (`dlq.>`, sin caducidad). Idempotente. */
export async function ensureStreams(
  nc: NatsConnection,
  manager: (nc: NatsConnection) => Promise<JetStreamManager> = jetstreamManager,
): Promise<void> {
  const jsm = await manager(nc);
  await upsertStream(jsm, { name: STREAM_EVENTOS, subjects: ['evt.>'], max_age: TREINTA_DIAS_NS });
  await upsertStream(jsm, { name: STREAM_DLQ, subjects: ['dlq.>'], max_age: 0 });
}
