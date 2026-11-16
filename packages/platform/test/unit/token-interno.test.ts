import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { llamarInterno, requireTokenInterno } from '../../src/index.js';

const TOKEN = 'a'.repeat(40);

describe('requireTokenInterno', () => {
  const pre = requireTokenInterno(TOKEN);
  test('token correcto pasa; incorrecto, ausente o de otra longitud → 404', async () => {
    await expect(pre({ headers: { 'x-token-interno': TOKEN } })).resolves.toBeUndefined();
    for (const headers of [{ 'x-token-interno': 'b'.repeat(40) }, {}, { 'x-token-interno': 'a'.repeat(39) }, { 'x-token-interno': TOKEN + 'a' }, { 'x-token-interno': [TOKEN, TOKEN] }]) {
      await expect(pre({ headers })).rejects.toMatchObject({ code: 'NO_ENCONTRADO', status: 404 });
    }
  });
});

describe('llamarInterno', () => {
  let srv: Server;
  let base: string;
  beforeAll(async () => {
    srv = createServer((req, res) => {
      if (req.headers['x-token-interno'] !== TOKEN) return void res.writeHead(404).end('{}');
      if (req.url === '/lento') return; // nunca responde
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(req.url === '/malo' ? { x: 1 } : { n: 7 }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
  });
  afterAll(async () => {
    srv.closeAllConnections();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  const esquema = z.object({ n: z.number() });
  test('200 válido devuelve el cuerpo; status ≠ 200, cuerpo inválido y timeout → Error', async () => {
    await expect(llamarInterno(base, '/ok', TOKEN, esquema)).resolves.toEqual({ n: 7 });
    await expect(llamarInterno(base, '/ok', 'x'.repeat(40), esquema)).rejects.toThrow('404');
    await expect(llamarInterno(base, '/malo', TOKEN, esquema)).rejects.toThrow();
    await expect(llamarInterno(base, '/lento', TOKEN, esquema, 100)).rejects.toThrow();
  });
});
