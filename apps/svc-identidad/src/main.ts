import { fileURLToPath } from 'node:url';
import { connect } from '@nats-io/transport-node';
import { createPool, ensureStreams, initTelemetry, runMigrations, shutdownTelemetry } from '@consultorio/platform';
import type { JWK } from 'jose';
import { buildServer } from './server.js';

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

// Única lectura de variables de entorno del servicio.
const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: requerida('DATABASE_URL'),
  migratorUrl: requerida('MIGRATOR_DATABASE_URL'),
  natsUrl: requerida('NATS_URL'),
  jwtPrivateJwk: JSON.parse(requerida('JWT_PRIVATE_JWK')) as JWK,
  authSecret: requerida('BETTER_AUTH_SECRET'),
  authUrl: requerida('BETTER_AUTH_URL'),
  // Orígenes (separados por coma) del sitio web que pueden hacer POST con cookies; vacío = ninguno.
  origenesConfiables: (process.env.ORIGENES_CONFIABLES ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  // Como el valor por defecto de Better Auth: límite activo solo en producción.
  authRateLimit: process.env.NODE_ENV === 'production',
};

initTelemetry('svc-identidad');
await runMigrations(env.migratorUrl, fileURLToPath(new URL('../migrations', import.meta.url)));

const pool = createPool(env.databaseUrl);
const nc = await connect({ servers: env.natsUrl });
await ensureStreams(nc);
const app = await buildServer({ pool, nc, jwtPrivateJwk: env.jwtPrivateJwk, betterAuth: { secret: env.authSecret, baseURL: env.authUrl, rateLimitEnabled: env.authRateLimit, trustedOrigins: env.origenesConfiables } });

const apagar = async (): Promise<void> => {
  await app.close();
  await nc.drain();
  await pool.end();
  await shutdownTelemetry();
};
for (const s of ['SIGTERM', 'SIGINT'] as const) process.once(s, () => void apagar().then(() => process.exit(0)));

await app.listen({ port: env.port, host: '0.0.0.0' });
