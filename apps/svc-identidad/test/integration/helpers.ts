import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NatsConnection } from '@nats-io/transport-node';
import { createPool, runMigrations } from '@consultorio/platform';
import { startPostgres, type TestPostgres } from '@consultorio/platform/testing';
import type { FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, type JWK } from 'jose';
import type pg from 'pg';
import { buildServer } from '../../src/server.js';

export const MIGRACIONES = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface Entorno {
  pgh: TestPostgres;
  migrator: pg.Pool;
  appPool: pg.Pool;
  stop(): Promise<void>;
}

/**
 * Las migraciones llevan el rol de producción `identidad_app`; en pruebas el rol de aplicación es
 * `test_app`, así que se aplica una copia temporal con el nombre sustituido.
 */
export async function prepararBase(): Promise<Entorno> {
  const pgh = await startPostgres();
  const dir = mkdtempSync(join(tmpdir(), 'identidad-mig-'));
  try {
    cpSync(MIGRACIONES, dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      writeFileSync(p, readFileSync(p, 'utf8').replaceAll('"identidad_app"', '"test_app"'));
    }
    await runMigrations(pgh.migratorUrl, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const migrator = createPool(pgh.migratorUrl);
  const appPool = createPool(pgh.appUrl);
  return {
    pgh,
    migrator,
    appPool,
    stop: async () => {
      await migrator.end();
      await appPool.end();
      await pgh.stop();
    },
  };
}

export async function llavePrivada(): Promise<JWK> {
  const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
  return { ...(await exportJWK(privateKey)), kid: 'identidad-test' };
}

export async function servidor(env: Entorno, nc?: NatsConnection): Promise<FastifyInstance> {
  const app = await buildServer({
    pool: env.appPool,
    ...(nc ? { nc } : {}),
    jwtPrivateJwk: await llavePrivada(),
    betterAuth: { secret: 'secreto-de-pruebas-'.repeat(3), baseURL: 'http://localhost:3000' },
  });
  await app.ready();
  return app;
}

export const registro = (slug: string, email = `${slug}@ejemplo.mx`, extra: Record<string, unknown> = {}) => ({
  nombreConsultorio: `Consultorio ${slug}`,
  slug,
  zonaHoraria: 'America/Mexico_City',
  admin: { nombre: 'Admin Prueba', email, password: 'clave-de-prueba-123' },
  ...extra,
});

export async function limpiar(migrator: pg.Pool): Promise<void> {
  await migrator.query('TRUNCATE outbox, perfil_medico, datos_fiscales, membresia, tenant, "twoFactor", session, account, verification, "user" CASCADE');
}
