import { fileURLToPath } from 'node:url';
import { connect } from '@nats-io/transport-node';
import { configAlmacenDesdeEnv, crearAlmacenS3, createLogger, createPool, ensureStreams, initTelemetry, runMigrations, shutdownTelemetry, startOutboxPublisher } from '@consultorio/platform';
import { iniciarConsumidor } from './consumidor.js';
import { crearCanalSmtp } from './correo/smtp.js';
import { crearClienteAgenda } from './externos/agenda.js';
import { crearClienteIdentidad } from './externos/identidad.js';
import { iniciarProgramador } from './programador.js';
import { buildServer } from './server.js';

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

// Única lectura de variables de entorno del servicio (la telemetría OTEL la lee initTelemetry).
const env = {
  port: Number(process.env.PORT ?? 3005),
  databaseUrl: requerida('DATABASE_URL'),
  migratorUrl: requerida('MIGRATOR_DATABASE_URL'),
  natsUrl: requerida('NATS_URL'),
  jwksUrl: requerida('JWKS_URL'),
  tokenInterno: requerida('TOKEN_INTERNO'),
  webOrigen: process.env.WEB_ORIGEN ?? 'http://localhost:3000',
  agendaUrl: requerida('AGENDA_URL'),
  identidadUrl: requerida('IDENTIDAD_URL'),
  smtpHost: requerida('SMTP_HOST'),
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUsuario: process.env.SMTP_USUARIO || undefined,
  smtpPassword: process.env.SMTP_PASSWORD || undefined,
  smtpRemitente: requerida('SMTP_REMITENTE'),
  almacen: configAlmacenDesdeEnv(process.env),
};
if (env.tokenInterno.length < 32) throw new Error('TOKEN_INTERNO debe tener al menos 32 caracteres');

initTelemetry('svc-notificaciones');
const logger = createLogger('svc-notificaciones');
await runMigrations(env.migratorUrl, fileURLToPath(new URL('../migrations', import.meta.url)));

const pool = createPool(env.databaseUrl, { logger });
const nc = await connect({ servers: env.natsUrl });
await ensureStreams(nc);
const puertos = {
  agenda: crearClienteAgenda(env.agendaUrl, env.tokenInterno),
  identidad: crearClienteIdentidad(env.identidadUrl, env.tokenInterno),
  correo: crearCanalSmtp({
    host: env.smtpHost,
    puerto: env.smtpPort,
    remitente: env.smtpRemitente,
    ...(env.smtpUsuario ? { usuario: env.smtpUsuario, ...(env.smtpPassword ? { password: env.smtpPassword } : {}) } : {}),
  }),
  almacen: crearAlmacenS3(env.almacen),
};
const reloj = () => new Date();
const ctxEnvio = { pool, puertos, reloj, webOrigen: env.webOrigen, logger };
const consumidor = await iniciarConsumidor({ pool, nc, identidad: puertos.identidad, logger, envio: ctxEnvio });
const programador = iniciarProgramador(ctxEnvio);
const publicador = startOutboxPublisher({ pool, nc, onError: (err) => logger.error({ err }, 'publicador del outbox') });
const app = await buildServer({ pool, jwksUrl: env.jwksUrl, tokenInterno: env.tokenInterno, webOrigen: env.webOrigen, reloj, puertos, logger });

let apagando = false;
const apagar = async (): Promise<void> => {
  if (apagando) return;
  apagando = true;
  // Cada paso es independiente: un fallo se registra y no impide cerrar el resto.
  const pasos: [string, () => Promise<unknown>][] = [
    ['servidor HTTP', () => app.close()],
    ['programador', () => programador.detener()],
    ['consumidor', () => consumidor.stop()],
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
