import { describe, expect, test, vi } from 'vitest';
import type { NatsConnection } from '@nats-io/transport-node';
import { esErrorDeMensaje, tipoValido, ensureStreams, headersPublicacion, subjectDlq, subjectEvento, traceparentDe } from '../../src/events/streams.js';

describe('subjects', () => {
  test('evt.<type> y dlq.<type>', () => {
    expect(subjectEvento('tenant.creado')).toBe('evt.tenant.creado');
    expect(subjectDlq('tenant.creado')).toBe('dlq.tenant.creado');
  });
});

describe('traceparentDe', () => {
  const trace = '0af7651916cd43dd8448eb211c80319c';
  test('construye traceparent W3C desde un trace_id de 32 hex', () => {
    expect(traceparentDe(trace)).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
  });
  test.each(['', 'abc', 'x'.repeat(32), '0'.repeat(32), trace + '0', trace.toUpperCase()])('omite si no es válido: %j', (t) => {
    expect(traceparentDe(t)).toBeUndefined();
  });
});

describe('headersPublicacion', () => {
  test('Nats-Msg-Id = event_id y traceparent si hay trace válido', () => {
    const h = headersPublicacion({ event_id: 'e1', trace_id: '0af7651916cd43dd8448eb211c80319c' });
    expect(h['Nats-Msg-Id']).toBe('e1');
    expect(h['traceparent']).toBeDefined();
  });
  test('sin traceparent si trace_id no es válido', () => {
    const h = headersPublicacion({ event_id: 'e1', trace_id: 'no-valido' });
    expect(h).toEqual({ 'Nats-Msg-Id': 'e1' });
  });
});

describe('ensureStreams', () => {
  test('crea/actualiza EVENTOS (30 días, límites) y DLQ', async () => {
    const add = vi.fn(async () => ({}));
    const update = vi.fn(async () => ({}));
    const info = vi.fn(async (name: string) => {
      if (name === 'EVENTOS') throw Object.assign(new Error('stream not found'), { code: '404' });
      return {};
    });
    const jsm = { streams: { add, update, info } };
    await ensureStreams({} as NatsConnection, async () => jsm as never);
    expect(add).toHaveBeenCalledTimes(1);
    const cfg = (add.mock.calls[0] as unknown as [{ name: string; subjects: string[]; max_age: number }])[0];
    expect(cfg.name).toBe('EVENTOS');
    expect(cfg.subjects).toEqual(['evt.>']);
    expect(cfg.max_age).toBe(30 * 24 * 3600 * 1e9);
    expect(update).toHaveBeenCalledTimes(1);
    expect((update.mock.calls[0] as unknown as [string])[0]).toBe('DLQ');
  });
  test('propaga errores distintos de "no existe"', async () => {
    const jsm = { streams: { info: async () => { throw new Error('caído'); }, add: vi.fn(), update: vi.fn() } };
    await expect(ensureStreams({} as NatsConnection, async () => jsm as never)).rejects.toThrow('caído');
  });
});

describe('tipoValido', () => {
  test.each(['tenant.creado', 'a', 'a_b-c.d1'])('acepta %j', (t) => expect(tipoValido(t)).toBe(true));
  test.each(['', 'a b', 'a..b', '.a', 'a.', 'a.>', 'a.*', 'A.b', 'a\nb'])('rechaza %j', (t) => expect(tipoValido(t)).toBe(false));
});

describe('esErrorDeMensaje', () => {
  test('subject/argumento inválido (también como causa) es de mensaje', () => {
    expect(esErrorDeMensaje(Object.assign(new Error('x'), { name: 'InvalidArgumentError' }))).toBe(true);
    expect(esErrorDeMensaje(Object.assign(new Error('x'), { name: 'InvalidSubjectError' }))).toBe(true);
    const envuelto = new Error('w', { cause: Object.assign(new Error('x'), { name: 'InvalidArgumentError' }) });
    expect(esErrorDeMensaje(envuelto)).toBe(true);
  });
  test('timeout, conexión u otros no lo son', () => {
    expect(esErrorDeMensaje(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(false);
    expect(esErrorDeMensaje(new Error('caído'))).toBe(false);
    expect(esErrorDeMensaje(undefined)).toBe(false);
    expect(esErrorDeMensaje('texto')).toBe(false);
  });
});
