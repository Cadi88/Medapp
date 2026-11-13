import { consultorioSchema } from '@consultorio/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { agregarMiembro, conToken, crearConsultorio, prepararBase, servidor, tokenDe, type Consultorio, type Entorno } from './helpers.js';

let env: Entorno;
let app: FastifyInstance;
let c: Consultorio;
let tokenRecepcion: string;
const eventos = async (tenantId: string) =>
  (
    await env.migrator.query<{ payload: { data: { campos: string[] } } }>(
      "select payload from outbox where type = 'consultorio.actualizado' and tenant_id = $1 order by event_id",
      [tenantId],
    )
  ).rows.map((r) => r.payload.data.campos);
const patch = (cuerpo: unknown, token = c.adminToken) =>
  app.inject({ method: 'PATCH', url: '/consultorio/personalizacion', payload: cuerpo as object, headers: conToken(token) });

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
  c = await crearConsultorio(app, 'personaliza-uno');
  await agregarMiembro(app, c, 'recepcion@personaliza.mx', 'recepcion');
  tokenRecepcion = await tokenDe(app, 'recepcion@personaliza.mx', c.tenantId, { mfa: false });
});
afterAll(async () => {
  await app.close();
  await env.stop();
});

describe('PATCH /consultorio/personalizacion', () => {
  test('guarda los datos, normaliza el teléfono a E.164 y devuelve el consultorio', async () => {
    const r = await patch({ nombreComercial: 'Clínica Sol', direccion: 'Av. Reforma 10', telefono: '(55) 1234-5678', colorPrimario: '#1e3a8a' });
    expect(r.statusCode).toBe(200);
    expect(consultorioSchema.parse(r.json())).toMatchObject({
      nombreComercial: 'Clínica Sol',
      direccion: 'Av. Reforma 10',
      telefono: '+525512345678',
      colorPrimario: '#1e3a8a',
      colorTexto: '#ffffff',
    });
    expect(await eventos(c.tenantId)).toEqual([['nombreComercial', 'direccion', 'telefono', 'colorPrimario']]);
  });

  test('emite consultorio.actualizado solo con los campos que cambiaron', async () => {
    const r = await patch({ nombreComercial: 'Clínica Sol', direccion: 'Calle Nueva 5', telefono: '5512345678' });
    expect(r.statusCode).toBe(200);
    expect((await eventos(c.tenantId)).at(-1)).toEqual(['direccion']);
  });

  test('sin cambios reales → 200 y no emite evento', async () => {
    const antes = await eventos(c.tenantId);
    const r = await patch({ nombreComercial: 'Clínica Sol', telefono: '+52 55 1234 5678', colorPrimario: '#1E3A8A' });
    expect(r.statusCode).toBe(200);
    expect(await eventos(c.tenantId)).toEqual(antes);
  });

  test('null borra el valor', async () => {
    const r = await patch({ direccion: null, colorPrimario: null });
    expect(consultorioSchema.parse(r.json())).toMatchObject({ direccion: null, colorPrimario: null, colorTexto: null });
    expect((await eventos(c.tenantId)).at(-1)).toEqual(['direccion', 'colorPrimario']);
  });

  test('teléfono inválido → 400 con campo telefono; color amarillo pálido → 400 "Elige un color más oscuro"', async () => {
    const t = await patch({ telefono: '123' });
    expect(t.statusCode).toBe(400);
    expect(t.json()).toMatchObject({ code: 'VALIDACION', details: [{ campo: 'telefono' }] });
    const col = await patch({ colorPrimario: '#fde68a' });
    expect(col.statusCode).toBe(400);
    expect(col.json()).toMatchObject({ message: 'Elige un color más oscuro', details: [{ campo: 'colorPrimario' }] });
    const mal = await patch({ colorPrimario: 'rojo' });
    expect(mal.statusCode).toBe(400);
    expect(mal.json()).toMatchObject({ message: 'Color inválido (usa el formato #rrggbb)', details: [{ campo: 'colorPrimario' }] });
  });

  test('cuerpo vacío, campos extra o nombre demasiado corto → 400', async () => {
    for (const cuerpo of [{}, { otro: 1 }, { nombreComercial: 'a' }]) expect((await patch(cuerpo)).statusCode).toBe(400);
  });

  test('recepción no admin → 403; sin token → 401', async () => {
    expect((await patch({ nombreComercial: 'Intruso' }, tokenRecepcion)).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/consultorio/personalizacion', payload: { nombreComercial: 'X Y' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/consultorio', headers: conToken(c.adminToken) })).json()).toMatchObject({ nombreComercial: 'Clínica Sol' });
  });
});
