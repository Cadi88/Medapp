import Fastify from 'fastify';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLogger, initTelemetry, ocultarTokenEnUrl, serializarReq, shutdownTelemetry } from '../../src/observability.js';

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

describe('token de respuesta en los logs', () => {
  test('ocultarTokenEnUrl enmascara el segmento tras /respuestas/ y subrutas, conserva el resto', () => {
    expect(ocultarTokenEnUrl('/respuestas/abc123')).toBe('/respuestas/[oculto]');
    expect(ocultarTokenEnUrl('/api/notificaciones/respuestas/abc123/logo?x=1')).toBe('/api/notificaciones/respuestas/[oculto]/logo?x=1');
    expect(ocultarTokenEnUrl('/respuestas/abc?y=2')).toBe('/respuestas/[oculto]?y=2');
    expect(ocultarTokenEnUrl('/recordatorios?desde=2030-01-01')).toBe('/recordatorios?desde=2030-01-01');
  });

  test('el logger aplica el serializador a req.url', () => {
    const m = memoria();
    const log = createLogger('svc-x', m.stream);
    log.info({ req: { method: 'GET', url: '/api/notificaciones/respuestas/SECRETO-TOKEN', host: 'h', ip: '1.1.1.1', headers: {}, socket: { remotePort: 5 } } }, 'incoming request');
    const [l] = m.json();
    expect(JSON.stringify(l)).not.toContain('SECRETO-TOKEN');
    expect(l).toMatchObject({ req: { method: 'GET', url: '/api/notificaciones/respuestas/[oculto]', host: 'h', remoteAddress: '1.1.1.1', remotePort: 5 } });
  });

  test('serializarReq tolera una petición sin url', () => {
    expect(serializarReq({ method: 'GET' })).toMatchObject({ method: 'GET', url: undefined });
  });
});

describe('Fastify con createLogger', () => {
  test('el log de la petición no contiene el token de /respuestas/', async () => {
    const m = memoria();
    const app = Fastify({ loggerInstance: createLogger('svc-x', m.stream) });
    app.get('/respuestas/:token', () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/respuestas/TOKEN-SECRETO' });
    await app.close();
    const texto = JSON.stringify(m.json());
    expect(texto).not.toContain('TOKEN-SECRETO');
    expect(texto).toContain('/respuestas/[oculto]');
  });
});
