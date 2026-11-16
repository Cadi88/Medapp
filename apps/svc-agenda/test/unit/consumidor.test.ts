import type { EventEnvelope } from '@consultorio/contracts';
import type pg from 'pg';
import type { Logger } from 'pino';
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

describe('manejarEvento · cita.respuesta_paciente', () => {
  const data = { citaId: '0198f5c2-0000-7000-8000-000000000009', inicioCita: '2030-01-08T16:00:00.000Z', respuesta: 'cancela', canal: 'correo', origen: 'paciente' };

  test('cita inexistente: solo un log info con el motivo, sin escribir ni exponer datos del paciente', async () => {
    const tx = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.PoolClient;
    const logger = { info: vi.fn() } as unknown as Logger;
    await manejarEvento(evento('cita.respuesta_paciente', 1, data), tx, logger);
    expect(logger.info).toHaveBeenCalledWith({ citaId: data.citaId, motivo: 'inexistente' }, expect.any(String));
    expect(tx.query).toHaveBeenCalledTimes(1);
  });

  test('payload inválido lanza sin tocar la base', async () => {
    const tx = { query: vi.fn() } as unknown as pg.PoolClient;
    await expect(manejarEvento(evento('cita.respuesta_paciente', 1, { citaId: 'x' }), tx)).rejects.toThrow();
    expect(tx.query).not.toHaveBeenCalled();
  });
});
