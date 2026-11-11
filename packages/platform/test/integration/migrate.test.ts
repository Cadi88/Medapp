import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runMigrations } from '../../src/index.js';
import { startPostgres } from '../../src/testing/index.js';

let pgh: Awaited<ReturnType<typeof startPostgres>>;
const dirs: string[] = [];

function mkdir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'mig-'));
  dirs.push(d);
  for (const [n, c] of Object.entries(files)) writeFileSync(join(d, n), c);
  return d;
}

async function q<T extends pg.QueryResultRow>(sql: string) {
  const c = new pg.Client({ connectionString: pgh.migratorUrl });
  await c.connect();
  try {
    return (await c.query<T>(sql)).rows;
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  pgh = await startPostgres();
});
afterAll(async () => {
  await pgh?.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('runMigrations', () => {
  test('es idempotente, aplica en orden léxico y devuelve los aplicados', async () => {
    const dir = mkdir({ '0002_b.sql': 'CREATE TABLE b (id int);', '0001_a.sql': 'CREATE TABLE a (id int);' });
    expect(await runMigrations(pgh.migratorUrl, dir)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(await runMigrations(pgh.migratorUrl, dir)).toHaveLength(0);
    const r = await q<{ nombre: string }>('select nombre from schema_migrations order by nombre');
    expect(r.map((x) => x.nombre)).toEqual(['0001_a.sql', '0002_b.sql']);
  });

  test('una migración fallida hace rollback de sí misma, no se registra y detiene la corrida', async () => {
    const dir = mkdir({
      '2001_ok.sql': 'CREATE TABLE ok1 (id int);',
      '2002_mala.sql': 'CREATE TABLE parcial (id int); SELECT 1/0;',
      '2003_nunca.sql': 'CREATE TABLE nunca (id int);',
    });
    await expect(runMigrations(pgh.migratorUrl, dir)).rejects.toThrow(/division by zero/);
    const reg = await q<{ nombre: string }>("select nombre from schema_migrations where nombre like '200%' order by nombre");
    expect(reg.map((x) => x.nombre)).toEqual(['2001_ok.sql']);
    const t = await q<{ tablename: string }>("select tablename from pg_tables where tablename in ('parcial','nunca')");
    expect(t).toEqual([]);
  });

  test('F4: el rol de la aplicación no puede leer, insertar ni borrar en schema_migrations (ni tras un GRANT previo)', async () => {
    const dir = mkdir({ '4001_x.sql': 'CREATE TABLE x4 (id int);' });
    await runMigrations(pgh.migratorUrl, dir);
    // Simula una base existente en la que los privilegios por defecto ya habían concedido acceso al rol app.
    await q('GRANT SELECT, INSERT, UPDATE, DELETE ON schema_migrations TO test_app');
    await runMigrations(pgh.migratorUrl, dir);
    const app = new pg.Client({ connectionString: pgh.appUrl });
    await app.connect();
    try {
      await expect(app.query("INSERT INTO schema_migrations (nombre) VALUES ('9999_futura.sql')")).rejects.toThrow(/permission denied/);
      await expect(app.query('DELETE FROM schema_migrations')).rejects.toThrow(/permission denied/);
      await expect(app.query('UPDATE schema_migrations SET nombre = nombre')).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
    const publico = await q<{ ok: boolean }>("select has_table_privilege('public', 'schema_migrations', 'INSERT') as ok");
    expect(publico[0]!.ok).toBe(false);
  });

  test('dos réplicas arrancando a la vez aplican cada archivo exactamente una vez', async () => {
    const dir = mkdir({
      '3001_c.sql': 'CREATE TABLE c1 (id int); SELECT pg_sleep(0.5);',
      '3002_d.sql': 'CREATE TABLE d1 (id int);',
    });
    const [r1, r2] = await Promise.all([runMigrations(pgh.migratorUrl, dir), runMigrations(pgh.migratorUrl, dir)]);
    expect([...r1, ...r2].sort()).toEqual(['3001_c.sql', '3002_d.sql']);
  });
});
