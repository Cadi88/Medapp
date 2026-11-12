import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { createPool, ensureStreams, runMigrations, withTenant } from '@consultorio/platform';
import { startNats, startPostgres, startTestJwks, type TestJwks, type TestNats, type TestPostgres } from '@consultorio/platform/testing';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { buildServer } from '../../src/server.js';

export const MIGRACIONES = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface ClaimsPrueba {
  sub?: string;
  tid: string;
  rol?: 'medico' | 'recepcion';
  admin?: boolean;
  mfa?: boolean;
}

export interface Agenda {
  app: FastifyInstance;
  pgh: TestPostgres;
  appPool: pg.Pool;
  migrator: pg.Pool;
  nats: TestNats;
  nc: NatsConnection;
  jwks: TestJwks;
  tokenPara(claims: ClaimsPrueba): Promise<string>;
  sembrarMedico(tenantId: string, usuarioId: string, nombre: string): Promise<void>;
  stop(): Promise<void>;
}

/** Las migraciones llevan el rol de producción `agenda_app`; en pruebas es `test_app`. */
async function migrar(url: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'agenda-mig-'));
  try {
    cpSync(MIGRACIONES, dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      writeFileSync(p, readFileSync(p, 'utf8').replaceAll('"agenda_app"', '"test_app"'));
    }
    await runMigrations(url, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function iniciarAgenda(): Promise<Agenda> {
  const [pgh, nats, jwks] = await Promise.all([startPostgres(), startNats(), startTestJwks()]);
  await migrar(pgh.migratorUrl);
  const migrator = createPool(pgh.migratorUrl);
  const appPool = createPool(pgh.appUrl);
  const nc = await connect({ servers: nats.url });
  await ensureStreams(nc);
  const app = await buildServer({ pool: appPool, jwksUrl: jwks.url, reloj: () => new Date() });
  await app.ready();
  return {
    app,
    pgh,
    appPool,
    migrator,
    nats,
    nc,
    jwks,
    tokenPara: (c) => jwks.sign({ sub: c.sub ?? uuidv7(), tid: c.tid, rol: c.rol ?? 'recepcion', admin: c.admin ?? false, mfa: c.mfa ?? true }),
    sembrarMedico: (tenantId, usuarioId, nombre) =>
      withTenant(appPool, tenantId, async (tx) => {
        await tx.query('INSERT INTO medico (tenant_id, usuario_id, nombre) VALUES ($1, $2, $3)', [tenantId, usuarioId, nombre]);
      }),
    stop: async () => {
      await app.close();
      await nc.drain();
      await migrator.end();
      await appPool.end();
      await jwks.stop();
      await nats.stop();
      await pgh.stop();
    },
  };
}
