import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

// Clave arbitraria fija del advisory lock de migraciones.
const MIGRATION_LOCK_KEY = 7_262_024_001;

export function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Aplica `*.sql` de `dir` en orden léxico, cada uno en su transacción. Idempotente.
 * Un advisory lock de sesión serializa réplicas concurrentes: la segunda espera y luego no ve nada pendiente.
 */
export async function runMigrations(url: string, dir: string): Promise<string[]> {
  const files = listMigrationFiles(dir);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (nombre text PRIMARY KEY, aplicado_en timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set((await client.query<{ nombre: string }>('SELECT nombre FROM schema_migrations')).rows.map((r) => r.nombre));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
      applied.push(file);
    }
    return applied;
  } finally {
    // Cerrar la sesión libera el advisory lock aunque el unlock falle.
    await client.end();
  }
}
