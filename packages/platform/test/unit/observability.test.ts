import { Writable } from 'node:stream';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLogger, initTelemetry, shutdownTelemetry } from '../../src/observability.js';

function memoria() {
  const lines: string[] = [];
  const stream = new Writable({
    write(c, _e, cb) {
      lines.push(String(c));
      cb();
    },
  });
  return { stream, json: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await shutdownTelemetry();
});

describe('createLogger', () => {
  test('incluye servicio y redacta authorization/cookie', () => {
    const m = memoria();
    createLogger('svc-x', m.stream).info(
      { req: { headers: { authorization: 'Bearer secreto', cookie: 'c=1', host: 'h' } } },
      'hola',
    );
    const [l] = m.json();
    expect(l).toMatchObject({ servicio: 'svc-x', msg: 'hola' });
    expect(JSON.stringify(l)).not.toContain('secreto');
    expect(JSON.stringify(l)).not.toContain('c=1');
    expect(JSON.stringify(l)).toContain('"host":"h"');
  });
  test('nivel por LOG_LEVEL, info por defecto', () => {
    vi.stubEnv('LOG_LEVEL', '');
    expect(createLogger('s').level).toBe('info');
    vi.stubEnv('LOG_LEVEL', 'debug');
    expect(createLogger('s').level).toBe('debug');
  });
});

describe('initTelemetry', () => {
  test('sin OTEL_EXPORTER_OTLP_ENDPOINT es no-op', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    expect(() => initTelemetry('s')).not.toThrow();
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
  test('con endpoint inicia el SDK una sola vez (idempotente) sin requerir colector', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:1');
    initTelemetry('s');
    expect(() => initTelemetry('s')).not.toThrow();
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
