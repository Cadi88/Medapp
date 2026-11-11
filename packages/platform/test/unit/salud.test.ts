import { createLocalJWKSet } from 'jose';
import { afterEach, expect, test } from 'vitest';
import { createHttpApp } from '../../src/http/app.js';

let app: Awaited<ReturnType<typeof createHttpApp>> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function montar() {
  process.env.LOG_LEVEL = 'silent';
  app = await createHttpApp({ servicio: 'svc-prueba', plugin: { verificador: createLocalJWKSet({ keys: [] }), rutasPublicas: [] } });
  app.get('/privada', () => ({ secreto: true }));
  await app.ready();
  return app;
}

test('GET /salud es pública y responde { ok: true }', async () => {
  const r = await (await montar()).inject({ method: 'GET', url: '/salud' });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true });
});

test('el resto de rutas siguen exigiendo token (401)', async () => {
  const r = await (await montar()).inject({ method: 'GET', url: '/privada' });
  expect(r.statusCode).toBe(401);
});
