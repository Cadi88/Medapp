import { describe, expect, test, vi } from 'vitest';
import type pg from 'pg';
import type { EventEnvelope } from '@consultorio/contracts';
import { enqueueEvent, envelopeToRow } from '../../src/events/outbox.js';

const evento: EventEnvelope = {
  event_id: '0190a000-0000-7000-8000-000000000001',
  type: 'tenant.creado',
  version: 1,
  tenant_id: '0190a000-0000-7000-8000-000000000002',
  actor_id: null,
  occurred_at: '2026-01-01T00:00:00.000Z',
  trace_id: 'abc',
  data: { x: 1 },
};

describe('envelopeToRow', () => {
  test('mapea el sobre a columnas con el sobre completo como payload', () => {
    const r = envelopeToRow(evento);
    expect(r.event_id).toBe(evento.event_id);
    expect(r.tenant_id).toBe(evento.tenant_id);
    expect(r.type).toBe('tenant.creado');
    expect(JSON.parse(r.payload)).toEqual(evento);
  });
});

describe('enqueueEvent', () => {
  test('inserta una fila en outbox con la transacción del llamador', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await enqueueEvent({ query } as unknown as pg.PoolClient, evento);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO outbox/);
    expect(params).toEqual([evento.event_id, evento.tenant_id, evento.type, JSON.stringify(evento)]);
  });
});
