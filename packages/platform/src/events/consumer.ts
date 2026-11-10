import { AckPolicy, jetstream, jetstreamManager, type JsMsg } from '@nats-io/jetstream';
import { headers as natsHeaders, type NatsConnection } from '@nats-io/transport-node';
import { eventEnvelopeSchema, type EventEnvelope } from '@consultorio/contracts';
import type pg from 'pg';
import { pino, type Logger } from 'pino';
import { withTenant } from '../db/tenant.js';
import { STREAM_EVENTOS, subjectDlq } from './streams.js';

export type EventHandler = (e: EventEnvelope, tx: pg.PoolClient, ctx: { logger: Logger }) => Promise<void>;

export interface ConsumeEventsOptions {
  pool: pg.Pool;
  nc: NatsConnection;
  consumidor: string;
  subjects: string[];
  handler: EventHandler;
  maxEntregas?: number;
  /** Espera (ms) antes de reentregar tras la entrega número `numEntrega`. */
  backoffMs?: (numEntrega: number) => number;
  logger?: Logger;
}

/** Entrega `numEntrega` (1 = primera) de `maxEntregas` permitidas: reintentar o mandar a dead-letter. */
export function decidirFallo(numEntrega: number, maxEntregas: number): 'reintentar' | 'dlq' {
  return numEntrega >= maxEntregas ? 'dlq' : 'reintentar';
}

/** Exponencial desde 1 s con tope de 30 s. */
export function backoffPorDefecto(numEntrega: number): number {
  return Math.min(1000 * 2 ** (numEntrega - 1), 30_000);
}

/** Cabeceras NATS no admiten saltos de línea: se colapsa el espacio en blanco y se trunca el mensaje. */
export function cabecerasDlq(err: unknown, entregas: number): Record<string, string> {
  const msg = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim().slice(0, 500);
  return { 'x-error': msg, 'x-entregas': String(entregas) };
}

const SUBJECT_INVALIDO = 'dlq.invalido';

/**
 * Consumidor durable idempotente. Por mensaje, en una sola transacción con el tenant del evento:
 * inserta en `inbox` (ON CONFLICT DO NOTHING) y, si es nuevo, ejecuta el handler; el ack va tras COMMIT.
 * Mensajes ilegibles van directo a `dlq.invalido`; el bucle nunca se cae por un mensaje.
 */
export async function consumeEvents(o: ConsumeEventsOptions): Promise<{ stop(): Promise<void> }> {
  const maxEntregas = o.maxEntregas ?? 5;
  const backoff = o.backoffMs ?? backoffPorDefecto;
  const logger = o.logger ?? pino({ level: 'silent' });
  const js = jetstream(o.nc);
  const jsm = await jetstreamManager(o.nc);
  await jsm.consumers.add(STREAM_EVENTOS, {
    durable_name: o.consumidor,
    ack_policy: AckPolicy.Explicit,
    filter_subjects: o.subjects,
    ack_wait: 30e9,
  });
  const consumer = await js.consumers.get(STREAM_EVENTOS, o.consumidor);
  const messages = await consumer.consume({ max_messages: 1 });

  const aDlq = async (subject: string, msg: JsMsg, err: unknown, msgID: string): Promise<boolean> => {
    try {
      const h = natsHeaders();
      for (const [k, v] of Object.entries(cabecerasDlq(err, msg.info.deliveryCount))) h.set(k, v);
      await js.publish(subject, msg.data, { headers: h, msgID, timeout: 5000 });
      return true;
    } catch (dlqErr) {
      logger.error({ err: dlqErr }, 'no se pudo publicar en la DLQ; se reintentará');
      return false;
    }
  };

  const procesar = async (msg: JsMsg): Promise<void> => {
    const entrega = msg.info.deliveryCount;
    let env: EventEnvelope;
    try {
      env = eventEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(msg.data))) as EventEnvelope;
    } catch (err) {
      logger.warn({ err, subject: msg.subject }, 'mensaje inválido; a dlq.invalido');
      if (await aDlq(SUBJECT_INVALIDO, msg, err, `invalido-${msg.info.streamSequence}`)) msg.term('mensaje inválido');
      else msg.nak(backoff(entrega));
      return;
    }
    const log = logger.child({ tenant_id: env.tenant_id, trace_id: env.trace_id, event_id: env.event_id, type: env.type });
    try {
      const nuevo = await withTenant(o.pool, env.tenant_id, async (tx) => {
        const r = await tx.query('INSERT INTO inbox (event_id, consumidor) VALUES ($1, $2) ON CONFLICT DO NOTHING', [env.event_id, o.consumidor]);
        if (r.rowCount === 0) return false;
        await o.handler(env, tx, { logger: log });
        return true;
      });
      if (!nuevo) log.info('evento duplicado; se omite');
      msg.ack();
    } catch (err) {
      if (decidirFallo(entrega, maxEntregas) === 'dlq') {
        log.error({ err, entrega }, 'entregas agotadas; a dead-letter');
        if (await aDlq(subjectDlq(env.type), msg, err, `dlq-${env.event_id}`)) msg.term('entregas agotadas');
        else msg.nak(backoff(entrega));
      } else {
        log.warn({ err, entrega }, 'el handler falló; se reintentará');
        msg.nak(backoff(entrega));
      }
    }
  };

  const bucle = (async () => {
    for await (const msg of messages) {
      try {
        await procesar(msg);
      } catch (err) {
        // Nunca tumbar el bucle (p. ej. conexión caída a mitad de un ack/nak).
        logger.error({ err }, 'error inesperado procesando un mensaje');
      }
    }
  })();

  return {
    async stop() {
      await messages.close();
      await bucle;
    },
  };
}
