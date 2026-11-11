import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

// Clave arbitraria fija del advisory lock de migraciones.
const MIGRATION_LOCK_KEY = 7_262_024_001;

const REVOCAR_SCHEMA_MIGRATIONS = `
DO $$
DECLARE r record;
BEGIN
  REVOKE ALL ON schema_migrations FROM PUBLIC;
  FOR r IN
    SELECT DISTINCT pg_get_userbyid(a.grantee) AS rol
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'schema_migrations'::regclass AND a.grantee <> 0 AND a.grantee <> c.relowner
  LOOP
    EXECUTE format('REVOKE ALL ON schema_migrations FROM %I', r.rol);
  END LOOP;
END
$$`;

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
    // Solo el dueño toca schema_migrations: los privilegios por defecto del migrador conceden DML al rol app, que
    // podría insertar nombres de migraciones futuras (y así saltárselas). Se revoca en cada corrida (idempotente).
    await client.query(REVOCAR_SCHEMA_MIGRATIONS);
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
