import type { EventEnvelope } from '@consultorio/contracts';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const consumeEvents = vi.fn();
vi.mock('@consultorio/platform', async (orig) => ({ ...(await orig<typeof import('@consultorio/platform')>()), consumeEvents }));
const registrar = vi.fn();
vi.mock('../../src/cadena.js', () => ({ registrar }));

const { iniciarConsumidor } = await import('../../src/consumidor.js');

describe('iniciarConsumidor', () => {
  beforeEach(() => {
    consumeEvents.mockReset();
    registrar.mockReset();
  });

  test('registra un consumidor durable "auditoria" sobre evt.> cuyo handler es registrar(tx, e)', async () => {
    const handle = { stop: vi.fn() };
    consumeEvents.mockResolvedValue(handle);
    const pool = {} as never;
    const nc = {} as never;
    const r = await iniciarConsumidor({ pool, nc });
    expect(r).toBe(handle);
    const o = consumeEvents.mock.calls[0]![0];
    expect(o).toMatchObject({ pool, nc, consumidor: 'auditoria', subjects: ['evt.>'] });
    const tx = {};
    const e = { event_id: 'x' } as EventEnvelope;
    await o.handler(e, tx, { logger: {} });
    expect(registrar).toHaveBeenCalledWith(tx, e);
  });
});
