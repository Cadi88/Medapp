import { describe, expect, test, vi } from 'vitest';
import { createPool } from '../../src/index.js';

describe('createPool', () => {
  test('crea un pool sin conectar y registra manejador de errores', async () => {
    const pool = createPool('postgres://u:p@localhost:1/db');
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    await pool.end();
  });

  test('connectionTimeoutMillis de 5 s por defecto (un connect colgado no excede ack_wait) y configurable', async () => {
    const pool = createPool('postgres://u:p@localhost:1/db');
    expect(pool.options.connectionTimeoutMillis).toBe(5000);
    await pool.end();
    const otro = createPool('postgres://u:p@localhost:1/db', { connectionTimeoutMillis: 1234 });
    expect(otro.options.connectionTimeoutMillis).toBe(1234);
    await otro.end();
  });

  test('los errores de conexiones ociosas se registran con el logger inyectado (no se ignoran)', async () => {
    const logger = { error: vi.fn() };
    const pool = createPool('postgres://u:p@localhost:1/db', { logger });
    const err = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    pool.emit('error', err, {} as never);
    expect(logger.error).toHaveBeenCalledWith({ err }, expect.stringMatching(/pool/));
    await pool.end();
  });

  test('sin logger se usa console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const pool = createPool('postgres://u:p@localhost:1/db');
      pool.emit('error', new Error('caída'), {} as never);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.join(' '))).toMatch(/caída/);
      await pool.end();
    } finally {
      spy.mockRestore();
    }
  });
});
