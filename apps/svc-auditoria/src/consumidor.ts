import type { NatsConnection } from '@nats-io/transport-node';
import { consumeEvents } from '@consultorio/platform';
import type pg from 'pg';
import type { Logger } from 'pino';
import { registrar } from './cadena.js';

/** Consumidor durable `auditoria` de todos los eventos (`evt.>`); dedupe por inbox y DLQ las pone la plataforma. */
export function iniciarConsumidor(o: { pool: pg.Pool; nc: NatsConnection; logger?: Logger }): Promise<{ stop(): Promise<void> }> {
  return consumeEvents({
    pool: o.pool,
    nc: o.nc,
    consumidor: 'auditoria',
    subjects: ['evt.>'],
    handler: (e, tx) => registrar(tx, e),
    ...(o.logger ? { logger: o.logger } : {}),
  });
}
