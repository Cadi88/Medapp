import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool, runMigrations } from '@consultorio/platform';
import { startPostgres } from '@consultorio/platform/testing';
import type pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { MIGRACIONES } from './helpers.js';

const U1 = '0190aaaa-0000-7000-8000-000000000001';
const U2 = '0190aaaa-0000-7000-8000-000000000002';
const U3 = '0190aaaa-0000-7000-8000-000000000003';
const T = '0190aaaa-0000-7000-8000-0000000000aa';

/** membresia tiene FORCE RLS también para el migrador: las escrituras necesitan el tenant activo. */
async function enTenant(pool: ReturnType<typeof createPool>, fn: (tx: pg.PoolClient) => Promise<unknown>): Promise<void> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SELECT set_config('app.tenant_id', $1, true)", [T]);
    await fn(tx);
    await tx.query('COMMIT');
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}

let pgh: Awaited<ReturnType<typeof startPostgres>>;
beforeAll(async () => {
  pgh = await startPostgres();
});
afterAll(async () => {
  await pgh.stop();
});

test('003 convierte admin en medico+admin, conserva el resto y estrecha el CHECK', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'identidad-mig003-'));
  const migrator = createPool(pgh.migratorUrl);
  try {
    // Solo 001 y 002 (con el rol de aplicación de pruebas); 003 se aplica después sobre datos existentes.
    const copiar = (f: string) =>
      writeFileSync(join(dir, f), readFileSync(join(MIGRACIONES, f), 'utf8').replaceAll('"identidad_app"', '"test_app"'));
    for (const f of readdirSync(MIGRACIONES).filter((x) => !x.startsWith('003'))) copiar(f);
    await runMigrations(pgh.migratorUrl, dir);

    for (const [id, email] of [[U1, 'a@x.mx'], [U2, 'b@x.mx'], [U3, 'c@x.mx']]) {
      await migrator.query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, 'N', $2, true)`, [id, email]);
    }
    await migrator.query(`INSERT INTO tenant (id, nombre, slug, zona_horaria) VALUES ($1, 'C', 'consultorio-003', 'America/Mexico_City')`, [T]);
    await enTenant(migrator, async (tx) => {
      await tx.query(`INSERT INTO membresia (tenant_id, usuario_id, rol) VALUES ($1, $2, 'admin'), ($1, $3, 'medico'), ($1, $4, 'recepcion')`, [T, U1, U2, U3]);
    });

    // Aplicar solo 003: se copia al directorio de trabajo (las anteriores ya constan en schema_migrations).
    copiar('003_roles_admin.sql');
    expect(await runMigrations(pgh.migratorUrl, dir)).toEqual(['003_roles_admin.sql']);

    const r = await migrator.query('SELECT usuario_id, rol, admin FROM membresia ORDER BY usuario_id');
    expect(r.rows).toEqual([
      { usuario_id: U1, rol: 'medico', admin: true },
      { usuario_id: U2, rol: 'medico', admin: false },
      { usuario_id: U3, rol: 'recepcion', admin: false },
    ]);
    await expect(
      enTenant(migrator, (tx) => tx.query(`UPDATE membresia SET rol = 'admin' WHERE usuario_id = $1`, [U2])),
    ).rejects.toMatchObject({ code: '23514' });

    const f = await migrator.query('SELECT rol, admin FROM fn_membresias_usuario($1)', [U1]);
    expect(f.rows).toEqual([{ rol: 'medico', admin: true }]);
  } finally {
    await migrator.end();
    rmSync(dir, { recursive: true, force: true });
  }
});
