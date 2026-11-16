import { fileURLToPath } from 'node:url';
import { connect } from '@nats-io/transport-node';
import { createLogger, createPool, ensureStreams, initTelemetry, runMigrations, shutdownTelemetry, startOutboxPublisher } from '@consultorio/platform';
import { buildServer } from './server.js';

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

// Única lectura de variables de entorno del servicio (la telemetría OTEL la lee initTelemetry).
// AGENDA_URL, IDENTIDAD_URL, SMTP_* y S3_* se leen en las siguientes tareas (clientes internos, correo y almacén).
const env = {
  port: Number(process.env.PORT ?? 3005),
  databaseUrl: requerida('DATABASE_URL'),
  migratorUrl: requerida('MIGRATOR_DATABASE_URL'),
  natsUrl: requerida('NATS_URL'),
  jwksUrl: requerida('JWKS_URL'),
  tokenInterno: requerida('TOKEN_INTERNO'),
  webOrigen: process.env.WEB_ORIGEN ?? 'http://localhost:3000',
};
if (env.tokenInterno.length < 32) throw new Error('TOKEN_INTERNO debe tener al menos 32 caracteres');

initTelemetry('svc-notificaciones');
const logger = createLogger('svc-notificaciones');
await runMigrations(env.migratorUrl, fileURLToPath(new URL('../migrations', import.meta.url)));

const pool = createPool(env.databaseUrl, { logger });
const nc = await connect({ servers: env.natsUrl });
await ensureStreams(nc);
const publicador = startOutboxPublisher({ pool, nc, onError: (err) => logger.error({ err }, 'publicador del outbox') });
const app = await buildServer({ pool, jwksUrl: env.jwksUrl, tokenInterno: env.tokenInterno, webOrigen: env.webOrigen, reloj: () => new Date() });

let apagando = false;
const apagar = async (): Promise<void> => {
  if (apagando) return;
  apagando = true;
  // Cada paso es independiente: un fallo se registra y no impide cerrar el resto.
  const pasos: [string, () => Promise<unknown>][] = [
    ['servidor HTTP', () => app.close()],
    ['publicador del outbox', () => publicador.stop()],
    ['NATS', () => nc.drain()],
    ['pool', () => pool.end()],
    ['telemetría', () => shutdownTelemetry()],
  ];
  for (const [nombre, paso] of pasos) {
    try {
      await paso();
    } catch (err) {
      logger.error({ err }, `error al cerrar ${nombre}`);
    }
  }
};
for (const s of ['SIGTERM', 'SIGINT'] as const) {
  process.once(s, () => {
    void apagar().finally(() => process.exit(0));
  });
}

await app.listen({ port: env.port, host: '0.0.0.0' });
