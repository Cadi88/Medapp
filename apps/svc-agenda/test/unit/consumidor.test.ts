import type { EventEnvelope } from '@consultorio/contracts';
import type pg from 'pg';
import { describe, expect, test, vi } from 'vitest';
import { manejarEvento } from '../../src/consumidor.js';

const evento = (type: string, version: number, data: unknown): EventEnvelope => ({
  event_id: '0198f5c2-0000-7000-8000-000000000001',
  type,
  version,
  tenant_id: '0198f5c2-0000-7000-8000-000000000002',
  actor_id: null,
  occurred_at: new Date().toISOString(),
  trace_id: 't',
  data,
});

describe('manejarEvento', () => {
  test('versión o tipo no soportado lanza (el consumidor lo manda a la DLQ)', async () => {
    const tx = { query: vi.fn() } as unknown as pg.PoolClient;
    await expect(manejarEvento(evento('usuario.vinculado', 3, {}), tx)).rejects.toThrow(/no soportado/);
    expect(tx.query).not.toHaveBeenCalled();
  });

  test('payload inválido lanza sin tocar la base', async () => {
    const tx = { query: vi.fn() } as unknown as pg.PoolClient;
    await expect(manejarEvento(evento('tenant.creado', 1, { tenantId: 'x' }), tx)).rejects.toThrow();
    expect(tx.query).not.toHaveBeenCalled();
  });
});
