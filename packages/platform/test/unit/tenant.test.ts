import { describe, expect, test, vi } from 'vitest';
import type pg from 'pg';
import { uuidv7, withTenant } from '../../src/index.js';

function fakePool(opts: { failOn?: string } = {}) {
  const calls: string[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (opts.failOn && sql.startsWith(opts.failOn)) throw new Error('boom ' + sql);
      return { rows: [] };
    }),
    release,
  };
  const connect = vi.fn(async () => client);
  return { pool: { connect } as unknown as pg.Pool, calls, release, connect };
}

describe('withTenant', () => {
  test.each(['', 'no-uuid', "' or 1=1 --", '00000000-0000-0000-0000-00000000000g'])(
    'rechaza tenantId inválido %j sin tocar la base',
    async (id) => {
      const { pool, connect } = fakePool();
      await expect(withTenant(pool, id, async () => 1)).rejects.toThrow('tenantId inválido');
      expect(connect).not.toHaveBeenCalled();
    },
  );

  test('BEGIN, set_config, fn, COMMIT y libera la conexión', async () => {
    const { pool, calls, release } = fakePool();
    const r = await withTenant(pool, uuidv7(), async () => 'ok');
    expect(r).toBe('ok');
    expect(calls).toEqual(['BEGIN', "SELECT set_config('app.tenant_id', $1, true)", 'COMMIT']);
    expect(release).toHaveBeenCalledWith();
  });

  test('ROLLBACK y relanza si fn falla', async () => {
    const { pool, calls, release } = fakePool();
    await expect(
      withTenant(pool, uuidv7(), async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledWith();
  });

  test('si el ROLLBACK también falla relanza el error original y destruye la conexión', async () => {
    const { pool, release } = fakePool({ failOn: 'ROLLBACK' });
    await expect(
      withTenant(pool, uuidv7(), async () => {
        throw new Error('original');
      }),
    ).rejects.toThrow('original');
    expect(release).toHaveBeenCalledWith(expect.any(Error));
  });
});
