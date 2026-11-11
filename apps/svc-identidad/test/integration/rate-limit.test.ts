import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ORIGEN, PASSWORD, llavePrivada, prepararBase, registro, type Entorno } from './helpers.js';
import { buildServer } from '../../src/server.js';

let env: Entorno;
let app: FastifyInstance;

beforeAll(async () => {
  env = await prepararBase();
  app = await buildServer({
    pool: env.appPool,
    jwtPrivateJwk: await llavePrivada(),
    betterAuth: { secret: 'secreto-de-pruebas-'.repeat(3), baseURL: 'http://localhost:3000', rateLimitEnabled: true },
  });
  await app.ready();
  expect((await app.inject({ method: 'POST', url: '/registro', payload: registro('rl-uno') })).statusCode).toBe(201);
});
afterAll(async () => {
  await app?.close();
  await env?.stop();
});

const signIn = (ip: string) =>
  app.inject({
    method: 'POST',
    url: '/auth/sign-in/email',
    payload: { email: 'rl-uno@ejemplo.mx', password: PASSWORD },
    headers: { origin: ORIGEN, 'x-forwarded-for': ip },
  });

describe('límite de sign-in de Better Auth por IP de cliente (x-forwarded-for)', () => {
  test('agotar los intentos de una IP da 429 y otra IP no se ve afectada', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 6; i++) estados.push((await signIn('203.0.113.1')).statusCode);
    expect(estados).toContain(429);
    expect(estados[0]).not.toBe(429);

    const otra = await signIn('203.0.113.2');
    expect(otra.statusCode).not.toBe(429);
  });
});
