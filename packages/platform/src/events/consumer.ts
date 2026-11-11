import { AckPolicy, jetstream, jetstreamManager, type JsMsg } from '@nats-io/jetstream';
import { headers as natsHeaders, type NatsConnection } from '@nats-io/transport-node';
import { eventEnvelopeSchema, type EventEnvelope } from '@consultorio/contracts';
import type pg from 'pg';
import { pino, type Logger } from 'pino';
import { withTenant } from '../db/tenant.js';
import { STREAM_EVENTOS, subjectDlq, tipoValido } from './streams.js';

export type EventHandler = (e: EventEnvelope, tx: pg.PoolClient, ctx: { logger: Logger }) => Promise<void>;

export interface ConsumeEventsOptions {
  pool: pg.Pool;
  nc: NatsConnection;
  consumidor: string;
  subjects: string[];
  handler: EventHandler;
  maxEntregas?: number;
  /** Espera (ms) antes de reentregar tras la entrega número `numEntrega` (fallos del handler). */
  backoffMs?: (numEntrega: number) => number;
  /** Espera (ms) antes de reentregar tras un error de infraestructura (por defecto exponencial con tope de 60 s). */
  backoffInfraMs?: (numEntrega: number) => number;
  /** Tiempo (ms) desde el timestamp del mensaje tras el cual un error de infraestructura va a la DLQ (por defecto 30 min). */
  presupuestoInfraMs?: number;
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

/** Exponencial desde 1 s con tope de 60 s (errores de infraestructura). */
export function backoffInfraPorDefecto(numEntrega: number): number {
  return Math.min(1000 * 2 ** (numEntrega - 1), 60_000);
}

/** Presupuesto por defecto para errores de infraestructura: cubre de sobra un failover/reinicio de RDS (60–120 s). */
export const PRESUPUESTO_INFRA_MS = 30 * 60_000;

/**
 * Error de infraestructura (la base no está disponible), no del evento: no cuenta para `maxEntregas`.
 * Se escala a la DLQ solo cuando han pasado `presupuestoMs` desde el timestamp del mensaje en el stream.
 */
export function decidirFalloInfra(timestampMensajeMs: number, ahoraMs: number, presupuestoMs = PRESUPUESTO_INFRA_MS): 'reintentar' | 'dlq' {
  return ahoraMs - timestampMensajeMs >= presupuestoMs ? 'dlq' : 'reintentar';
}

/** SQLSTATE: clase 08 (excepción de conexión), 57P01–57P03 (servidor apagándose / no acepta conexiones), 53300 (demasiadas conexiones). */
const SQLSTATE_INFRA = /^(08[0-9A-Z]{3}|57P0[123]|53300)$/;
const CODIGOS_RED = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);
/** Mensajes exactos de pg / pg-pool sin código: timeout de connect del pool, conexión cortada, cliente inutilizable. */
const MENSAJES_INFRA = new Set([
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Client has encountered a connection error and is not queryable',
]);

/** ¿El error (o alguno en su cadena `cause` / `AggregateError.errors`) indica que la base no está disponible? */
export function esErrorDeInfraestructura(err: unknown): boolean {
  const vistos = new Set<unknown>();
  const pendientes: unknown[] = [err];
  while (pendientes.length > 0 && vistos.size < 20) {
    const e = pendientes.shift();
    if (typeof e !== 'object' || e === null || vistos.has(e)) continue;
    vistos.add(e);
    const { code, message, cause, errors } = e as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
    if (typeof code === 'string' && (SQLSTATE_INFRA.test(code) || CODIGOS_RED.has(code))) return true;
    if (typeof message === 'string' && MENSAJES_INFRA.has(message)) return true;
    pendientes.push(cause);
    if (Array.isArray(errors)) pendientes.push(...(errors as unknown[]));
  }
  return false;
}

/** Cabeceras NATS no admiten saltos de línea: se colapsa el espacio en blanco y se trunca el mensaje. */
export function cabecerasDlq(err: unknown, entregas: number, consumidor = ''): Record<string, string> {
  const msg = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim().slice(0, 500);
  return { 'x-error': msg, 'x-entregas': String(entregas), 'x-consumidor': consumidor };
}

const CONSUMIDOR_EXISTENTE = 10148;

export function esConsumidorExistente(err: unknown): boolean {
  const e = err as { code?: unknown; apiError?: () => { err_code?: number } };
  const api = typeof e?.apiError === 'function' ? e.apiError() : undefined;
  return api?.err_code === CONSUMIDOR_EXISTENTE || e?.code === CONSUMIDOR_EXISTENTE;
}

/** `dlq.<type>` si el type es seguro como subject; si no, `dlq.invalido`. */
export const subjectDlqSeguro = (type: string): string => (tipoValido(type) ? subjectDlq(type) : 'dlq.invalido');

const SUBJECT_INVALIDO = 'dlq.invalido';

/**
 * Consumidor durable idempotente. Por mensaje, en una sola transacción con el tenant del evento:
 * inserta en `inbox` (ON CONFLICT DO NOTHING) y, si es nuevo, ejecuta el handler; el ack va tras COMMIT.
 * Mensajes ilegibles van directo a `dlq.invalido`; el bucle nunca se cae por un mensaje.
 */
export async function consumeEvents(o: ConsumeEventsOptions): Promise<{ stop(): Promise<void> }> {
  const maxEntregas = o.maxEntregas ?? 5;
  const backoff = o.backoffMs ?? backoffPorDefecto;
  const backoffInfra = o.backoffInfraMs ?? backoffInfraPorDefecto;
  const presupuestoInfra = o.presupuestoInfraMs ?? PRESUPUESTO_INFRA_MS;
  const logger = o.logger ?? pino({ level: 'silent' });
  const js = jetstream(o.nc);
  const jsm = await jetstreamManager(o.nc);
  const ACK_WAIT = 30e9;
  try {
    await jsm.consumers.add(STREAM_EVENTOS, {
      durable_name: o.consumidor,
      ack_policy: AckPolicy.Explicit,
      filter_subjects: o.subjects,
      ack_wait: ACK_WAIT,
    });
  } catch (err) {
    // 10148: el durable ya existe con otra configuración (p. ej. cambió la lista de subjects en un despliegue).
    if (!esConsumidorExistente(err)) throw err;
    await jsm.consumers.update(STREAM_EVENTOS, o.consumidor, { filter_subjects: o.subjects, ack_wait: ACK_WAIT });
  }
  const consumer = await js.consumers.get(STREAM_EVENTOS, o.consumidor);
  const messages = await consumer.consume({ max_messages: 1 });

  const aDlq = async (subject: string, msg: JsMsg, err: unknown, msgID: string): Promise<boolean> => {
    try {
      const h = natsHeaders();
      for (const [k, v] of Object.entries(cabecerasDlq(err, msg.info.deliveryCount, o.consumidor))) h.set(k, v);
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
    let handlerCorrio = false;
    try {
      const nuevo = await withTenant(o.pool, env.tenant_id, async (tx) => {
        const r = await tx.query('INSERT INTO inbox (event_id, consumidor) VALUES ($1, $2) ON CONFLICT DO NOTHING', [env.event_id, o.consumidor]);
        if (r.rowCount === 0) return false;
        handlerCorrio = true;
        await o.handler(env, tx, { logger: log });
        return true;
      });
      if (!nuevo) log.info('evento duplicado; se omite');
      msg.ack();
    } catch (err) {
      // Infraestructura: la base no responde (connect, conexión caída, COMMIT por red) o el fallo ocurrió antes del
      // handler. No cuenta entregas: se reintenta con backoff hasta agotar el presupuesto de tiempo del mensaje.
      if (!handlerCorrio || esErrorDeInfraestructura(err)) {
        const timestampMs = Math.floor(msg.info.timestampNanos / 1e6);
        if (decidirFalloInfra(timestampMs, Date.now(), presupuestoInfra) === 'dlq') {
          log.error({ err, entrega }, 'base de datos no disponible durante todo el presupuesto; a dead-letter');
          if (await aDlq(subjectDlqSeguro(env.type), msg, err, `dlq-${o.consumidor}-${env.event_id}`)) msg.term('presupuesto de infraestructura agotado');
          else msg.nak(backoffInfra(entrega));
        } else {
          log.warn({ err, entrega }, 'error de infraestructura; se reintentará sin contar para la DLQ');
          msg.nak(backoffInfra(entrega));
        }
      } else if (decidirFallo(entrega, maxEntregas) === 'dlq') {
        log.error({ err, entrega }, 'entregas agotadas; a dead-letter');
        if (await aDlq(subjectDlqSeguro(env.type), msg, err, `dlq-${o.consumidor}-${env.event_id}`)) msg.term('entregas agotadas');
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
