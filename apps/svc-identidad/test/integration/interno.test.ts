import { consultorioParaMensajeSchema } from '@consultorio/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { conToken, crearConsultorio, prepararBase, servidor, TOKEN_INTERNO_PRUEBA, type Consultorio, type Entorno } from './helpers.js';

let env: Entorno;
let app: FastifyInstance;
let c: Consultorio;
const SIN_TENANT = '0198f2a0-0000-7000-8000-0000000000ff';

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
  c = await crearConsultorio(app, 'interno-uno');
});
afterAll(async () => {
  await app.close();
  await env.stop();
});

const get = (query: string, token: string | null = TOKEN_INTERNO_PRUEBA) =>
  app.inject({ method: 'GET', url: `/interno/consultorio-para-mensaje?${query}`, ...(token ? { headers: { 'x-token-interno': token } } : {}) });

describe('GET /interno/consultorio-para-mensaje', () => {
  test('sin token, token incorrecto o JWT en su lugar → 404', async () => {
    const q = `tenantId=${c.tenantId}`;
    expect((await get(q, null)).statusCode).toBe(404);
    expect((await get(q, 'x'.repeat(TOKEN_INTERNO_PRUEBA.length))).statusCode).toBe(404);
    const r = await app.inject({ method: 'GET', url: `/interno/consultorio-para-mensaje?${q}`, headers: conToken(c.adminToken) });
    expect(r.statusCode).toBe(404);
  });

  test('sin personalización devuelve el nombre del consultorio y datos de marca vacíos', async () => {
    const r = await get(`tenantId=${c.tenantId}`);
    expect(r.statusCode).toBe(200);
    expect(consultorioParaMensajeSchema.parse(r.json())).toEqual({
      nombreMostrado: 'Consultorio interno-uno',
      telefono: null,
      colorPrimario: null,
      colorTexto: null,
      logoKey: null,
      zonaHoraria: 'America/Mexico_City',
      pais: 'MX',
    });
  });

  test('con personalización devuelve nombre comercial, teléfono, color, colorTexto y logoKey', async () => {
    const p = await app.inject({
      method: 'PATCH',
      url: '/consultorio/personalizacion',
      headers: conToken(c.adminToken),
      payload: { nombreComercial: 'Clínica Sol', telefono: '5512345678', colorPrimario: '#0a5c36' },
    });
    expect(p.statusCode).toBe(200);
    await env.migrator.query('UPDATE tenant SET logo_key = $2 WHERE id = $1', [c.tenantId, `logos/${c.tenantId}/abc.png`]);
    const r = await get(`tenantId=${c.tenantId}`);
    expect(r.statusCode).toBe(200);
    expect(consultorioParaMensajeSchema.parse(r.json())).toEqual({
      nombreMostrado: 'Clínica Sol',
      telefono: '+525512345678',
      colorPrimario: '#0a5c36',
      colorTexto: '#ffffff',
      logoKey: `logos/${c.tenantId}/abc.png`,
      zonaHoraria: 'America/Mexico_City',
      pais: 'MX',
    });
  });

  test('tenantId inválido → 400; tenant inexistente → 404', async () => {
    expect((await get('tenantId=x')).statusCode).toBe(400);
    expect((await get('')).statusCode).toBe(400);
    expect((await get(`tenantId=${SIN_TENANT}`)).statusCode).toBe(404);
  });
});
