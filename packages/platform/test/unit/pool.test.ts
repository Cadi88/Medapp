import { describe, expect, test } from 'vitest';
import { createPool } from '../../src/index.js';

describe('createPool', () => {
  test('crea un pool sin conectar y registra manejador de errores', async () => {
    const pool = createPool('postgres://u:p@localhost:1/db');
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    await pool.end();
  });
});
