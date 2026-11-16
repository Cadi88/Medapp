import { CitaCancelada } from '@consultorio/contracts';
import type pg from 'pg';
import { describe, expect, test, vi } from 'vitest';
import { manejarEvento } from '../../src/consumidor.js';

describe('manejarEvento', () => {
  test('cita.cancelada anula sin consultar la zona ni llamar a identidad', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const identidad = { obtenerConsultorio: vi.fn().mockRejectedValue(new Error('no debe llamarse')) };
    const T = '0198a3a6-0000-7000-8000-000000000001';
    const e = CitaCancelada.create({
      tenantId: T,
      actorId: null,
      traceId: 't',
      data: { citaId: '0198a3a6-0000-7000-8000-000000000002', medicoId: '0198a3a6-0000-7000-8000-000000000003', inicio: '2031-05-02T17:30:00.000Z', fin: '2031-05-02T18:00:00.000Z' },
    });
    await manejarEvento(e, { query } as unknown as pg.PoolClient, identidad);
    expect(identidad.obtenerConsultorio).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatch(/UPDATE envio SET estado = 'anulado'/);
  });

  test('un tipo de evento desconocido se rechaza', async () => {
    await expect(manejarEvento({ type: 'otra.cosa', version: 1 } as never, {} as pg.PoolClient, { obtenerConsultorio: vi.fn() })).rejects.toThrow(/no soportado/);
  });
});
