import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventEnvelope } from '@consultorio/contracts';
import { createPool, runMigrations, withTenant } from '@consultorio/platform';
import { startPostgres, type TestPostgres } from '@consultorio/platform/testing';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { registrar } from '../../src/cadena.js';

export const MIGRACIONES = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface Entorno {
  pgh: TestPostgres;
  migrator: pg.Pool;
  appPool: pg.Pool;
  stop(): Promise<void>;
}

/** Las migraciones llevan el rol de producción `auditoria_app`; en pruebas es `test_app`. */
export async function prepararBase(): Promise<Entorno> {
  const pgh = await startPostgres();
  const dir = mkdtempSync(join(tmpdir(), 'auditoria-mig-'));
  try {
    cpSync(MIGRACIONES, dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      writeFileSync(p, readFileSync(p, 'utf8').replaceAll('"auditoria_app"', '"test_app"'));
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

export const tenantId = (): string => uuidv7();

export function evento(tenant: string, over: Partial<EventEnvelope> = {}): EventEnvelope {
  const usuarioId = uuidv7();
  return {
    event_id: uuidv7(),
    type: 'usuario.vinculado',
    version: 1,
    tenant_id: tenant,
    actor_id: uuidv7(),
    occurred_at: new Date().toISOString(),
    trace_id: 'trace-prueba',
    data: { usuarioId, rol: 'medico' },
    ...over,
  };
}

export const registrarN = async (env: Entorno, tenant: string, n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await withTenant(env.appPool, tenant, (tx) => registrar(tx, evento(tenant)));
};

export async function leer(env: Entorno, tenant: string): Promise<FilaLeida[]> {
  return withTenant(env.appPool, tenant, async (tx) => (await tx.query('SELECT * FROM evento_auditoria ORDER BY secuencia')).rows);
}

/**
 * Altera filas como el dueño de las tablas (el migrador): la política FORCE RLS también le aplica,
 * así que se fija el tenant igual que lo haría un atacante con acceso al dueño.
 */
export async function comoDueno(env: Entorno, tenant: string, sql: string, params: unknown[] = []): Promise<number> {
  return withTenant(env.migrator, tenant, async (tx) => (await tx.query(sql, params)).rowCount ?? 0);
}

export interface FilaLeida {
  secuencia: string;
  hash: string;
  hash_anterior: string;
  ocurrido_en: Date;
  [k: string]: unknown;
}

export const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
