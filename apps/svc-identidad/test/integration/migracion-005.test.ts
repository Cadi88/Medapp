import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool, runMigrations } from '@consultorio/platform';
import { startPostgres } from '@consultorio/platform/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { MIGRACIONES } from './helpers.js';

const T = '0190aaaa-0000-7000-8000-0000000000bb';

let pgh: Awaited<ReturnType<typeof startPostgres>>;
beforeAll(async () => {
  pgh = await startPostgres();
});
afterAll(async () => {
  await pgh.stop();
});

test('005 deja consultorios existentes en MX/MXN y logo_version 0; identidad_app no edita nombre, slug, país ni moneda', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'identidad-mig005-'));
  const migrator = createPool(pgh.migratorUrl);
  const app = createPool(pgh.appUrl);
  try {
    const copiar = (f: string) =>
      writeFileSync(join(dir, f), readFileSync(join(MIGRACIONES, f), 'utf8').replaceAll('"identidad_app"', '"test_app"'));
    for (const f of readdirSync(MIGRACIONES).filter((x) => !x.startsWith('005'))) copiar(f);
    await runMigrations(pgh.migratorUrl, dir);
    await migrator.query(`INSERT INTO tenant (id, nombre, slug, zona_horaria) VALUES ($1, 'C', 'consultorio-005', 'America/Mexico_City')`, [T]);

    copiar('005_personalizacion.sql');
    expect(await runMigrations(pgh.migratorUrl, dir)).toEqual(['005_personalizacion.sql']);

    const r = await migrator.query('SELECT pais, moneda, logo_version, logo_key, color_primario, nombre_comercial, direccion, telefono FROM tenant');
    expect(r.rows).toEqual([
      { pais: 'MX', moneda: 'MXN', logo_version: 0, logo_key: null, color_primario: null, nombre_comercial: null, direccion: null, telefono: null },
    ]);

    await app.query(`UPDATE tenant SET nombre_comercial = 'Clínica Sol', color_primario = '#1e3a8a', logo_version = logo_version + 1 WHERE id = $1`, [T]);
    for (const col of ['nombre', 'slug', 'pais', 'moneda', 'zona_horaria', 'plan']) {
      await expect(app.query(`UPDATE tenant SET ${col} = ${col} WHERE id = $1`, [T]), col).rejects.toMatchObject({ code: '42501' });
    }
    await expect(migrator.query(`UPDATE tenant SET pais = 'AR' WHERE id = $1`, [T])).rejects.toMatchObject({ code: '23514' });
    await expect(migrator.query(`UPDATE tenant SET color_primario = '#1E3A8A' WHERE id = $1`, [T])).rejects.toMatchObject({ code: '23514' });
  } finally {
    await migrator.end();
    await app.end();
    rmSync(dir, { recursive: true, force: true });
  }
});
