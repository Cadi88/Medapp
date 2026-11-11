import { fileURLToPath } from 'node:url';
import { connect } from '@nats-io/transport-node';
import { createLogger, createPool, ensureStreams, initTelemetry, runMigrations, shutdownTelemetry } from '@consultorio/platform';
import { iniciarConsumidor } from './consumidor.js';
import { iniciarProgramador } from './programador.js';
import { buildServer } from './server.js';

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

// Única lectura de variables de entorno del servicio (la telemetría OTEL la lee initTelemetry).
const env = {
  port: Number(process.env.PORT ?? 3003),
  databaseUrl: requerida('DATABASE_URL'),
  migratorUrl: requerida('MIGRATOR_DATABASE_URL'),
  natsUrl: requerida('NATS_URL'),
  jwksUrl: requerida('JWKS_URL'),
};

initTelemetry('svc-auditoria');
const logger = createLogger('svc-auditoria');
await runMigrations(env.migratorUrl, fileURLToPath(new URL('../migrations', import.meta.url)));

const pool = createPool(env.databaseUrl, { logger });
const nc = await connect({ servers: env.natsUrl });
await ensureStreams(nc);
const consumidor = await iniciarConsumidor({ pool, nc, logger });
const programador = iniciarProgramador({ pool, logger });
const app = await buildServer({ pool, jwksUrl: env.jwksUrl });

let apagando = false;
const apagar = async (): Promise<void> => {
  if (apagando) return;
  apagando = true;
  // Cada paso es independiente: un fallo se registra y no impide cerrar el resto.
  const pasos: [string, () => Promise<unknown>][] = [
    ['servidor HTTP', () => app.close()],
    ['programador', () => programador.stop()],
    ['consumidor', () => consumidor.stop()],
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
