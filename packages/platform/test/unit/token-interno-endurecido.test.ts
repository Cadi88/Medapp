import Fastify from 'fastify';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { llamarInterno, requireTokenInterno, rutasInternas } from '../../src/index.js';

const TOKEN = 'a'.repeat(40);

describe('requireTokenInterno: token de configuración', () => {
  test.each(['', 'corto', 'a'.repeat(31)])('token de %j (< 32) falla al construir', (t) => {
    expect(() => requireTokenInterno(t)).toThrow('32');
  });
});

describe('rutasInternas', () => {
  test('toda ruta del plugin exige el token aunque no declare preHandler; fuera del plugin no aplica', async () => {
    const app = Fastify();
    await app.register(
      rutasInternas(TOKEN, async (i) => {
        i.get('/interno/a', async () => ({ ok: true }));
      }),
    );
    app.get('/otra', async () => ({ ok: true }));
    app.setErrorHandler((err, _req, reply) => void reply.code((err as { status?: number }).status ?? 500).send({}));
    await app.ready();
    expect((await app.inject({ url: '/interno/a' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/interno/a', headers: { 'x-token-interno': 'b'.repeat(40) } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/interno/a', headers: { 'x-token-interno': TOKEN } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/otra' })).statusCode).toBe(200);
    await app.close();
  });
});

describe('llamarInterno: respuesta de error', () => {
  test('con status distinto de 200 cancela el cuerpo antes de lanzar', async () => {
    const cancel = vi.fn(async () => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ status: 500, body: { cancel } } as unknown as Response);
    await expect(llamarInterno('http://x', '/y', TOKEN, z.object({}))).rejects.toThrow('500');
    expect(cancel).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
