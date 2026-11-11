import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPool, rlsPolicySql, runMigrations, uuidv7, withTenant } from '../../src/index.js';
import { startPostgres } from '../../src/testing/index.js';

let pgh: Awaited<ReturnType<typeof startPostgres>>;
let app: pg.Pool;
let dir: string;
const A = uuidv7();
const B = uuidv7();

beforeAll(async () => {
  pgh = await startPostgres();
  dir = mkdtempSync(join(tmpdir(), 'tenant-'));
  writeFileSync(join(dir, '0001_nota.sql'), `CREATE TABLE nota (tenant_id uuid NOT NULL, texto text);\n${rlsPolicySql('nota')}`);
  await runMigrations(pgh.migratorUrl, dir);
  app = createPool(pgh.appUrl);
});

afterAll(async () => {
  await app?.end();
  await pgh?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('aislamiento por tenant (RLS)', () => {
  test('un tenant no ve filas de otro', async () => {
    await withTenant(app, A, (tx) => tx.query("insert into nota values ($1,'a')", [A]));
    await withTenant(app, B, (tx) => tx.query("insert into nota values ($1,'b')", [B]));
    const r = await withTenant(app, A, (tx) => tx.query('select texto from nota'));
    expect(r.rows).toEqual([{ texto: 'a' }]);
  });

  test('sin contexto de tenant no se ve nada (ni error) aunque la conexión ya se usó con un tenant', async () => {
    const c = await app.connect();
    await c.query('begin');
    await c.query("select set_config('app.tenant_id', $1, true)", [A]);
    await c.query('commit');
    expect((await c.query('select * from nota')).rowCount).toBe(0);
    c.release();
  });

  test('FORCE RLS: el dueño de la tabla (migrador) sin tenant no ve filas ni puede insertar; con su tenant sí ve las suyas', async () => {
    await withTenant(app, A, (tx) => tx.query("insert into nota values ($1,'del dueño')", [A]));
    const dueno = createPool(pgh.migratorUrl);
    try {
      const esDueno = await dueno.query("select pg_get_userbyid(relowner) = current_user as ok from pg_class where relname = 'nota'");
      expect(esDueno.rows[0].ok).toBe(true);
      expect((await dueno.query('select * from nota')).rowCount).toBe(0);
      await expect(dueno.query("insert into nota values ($1,'x')", [A])).rejects.toThrow(/row-level security/);
      const propias = await withTenant(dueno, A, (tx) => tx.query('select texto from nota'));
      expect(propias.rows.map((r) => r.texto)).toContain('del dueño');
    } finally {
      await dueno.end();
    }
  });

  test('no se puede insertar con tenant_id ajeno', async () => {
    await expect(withTenant(app, A, (tx) => tx.query("insert into nota values ($1,'x')", [B]))).rejects.toThrow(/row-level security/);
  });

  test('el contexto no se filtra a la siguiente transacción del mismo pool', async () => {
    await withTenant(app, A, async () => {});
    expect((await app.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? '').toBe('');
  });

  test('un tenant no puede actualizar ni borrar filas de otro', async () => {
    const u = await withTenant(app, B, (tx) => tx.query("update nota set texto='hack' where texto='a'"));
    const d = await withTenant(app, B, (tx) => tx.query("delete from nota where texto='a'"));
    expect(u.rowCount).toBe(0);
    expect(d.rowCount).toBe(0);
  });

  test('un error en fn hace rollback', async () => {
    await expect(
      withTenant(app, A, async (tx) => {
        await tx.query("insert into nota values ($1,'rollback')", [A]);
        throw new Error('fallo');
      }),
    ).rejects.toThrow('fallo');
    const r = await withTenant(app, A, (tx) => tx.query("select 1 from nota where texto='rollback'"));
    expect(r.rowCount).toBe(0);
  });

  test('si fn traga un error de base de datos, withTenant rechaza y nada persiste', async () => {
    await expect(
      withTenant(app, A, async (tx) => {
        await tx.query("insert into nota values ($1,'persistente?')", [A]);
        try {
          await tx.query("insert into nota values ($1,'ajeno')", [B]);
        } catch {
          // error tragado: la transacción queda abortada
        }
        return 'ok';
      }),
    ).rejects.toThrow(/abortada/);
    const r = await withTenant(app, A, (tx) => tx.query("select 1 from nota where texto in ('persistente?','ajeno')"));
    expect(r.rowCount).toBe(0);
  });

  test('el rol de la aplicación no tiene BYPASSRLS ni es superusuario', async () => {
    const r = await app.query('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});
