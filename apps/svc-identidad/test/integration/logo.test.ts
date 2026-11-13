import { consultorioSchema } from '@consultorio/contracts';
import { asegurarBucket, crearAlmacenS3, type Almacen } from '@consultorio/platform';
import { startMinio, type TestMinio } from '@consultorio/platform/testing';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { agregarMiembro, conToken, crearConsultorio, prepararBase, servidor, tokenDe, type Consultorio, type Entorno } from './helpers.js';

let env: Entorno;
let minio: TestMinio;
let app: FastifyInstance;
let almacen: Almacen;
/** Llaves que el servicio intentó guardar, en orden. */
const guardadas: string[] = [];
/** Simula un fallo del borrado en el almacenamiento. */
let borradoCaido = false;
let a: Consultorio;
let b: Consultorio;
let tokenRecepcion: string;

const png = (w = 40, h = 20) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
const put = (cuerpo: Buffer, token = a.adminToken, tipo = 'image/png', servidorHttp: FastifyInstance = app) =>
  servidorHttp.inject({ method: 'PUT', url: '/consultorio/logo', payload: cuerpo, headers: { ...conToken(token), 'content-type': tipo } });
const del = (token = a.adminToken) => app.inject({ method: 'DELETE', url: '/consultorio/logo', headers: conToken(token) });
const getLogo = (token = a.adminToken) => app.inject({ method: 'GET', url: '/consultorio/logo', headers: conToken(token) });
const getConsultorio = (token = a.adminToken) => app.inject({ method: 'GET', url: '/consultorio', headers: conToken(token) });
const fila = async (tenantId: string) =>
  (await env.migrator.query<{ logo_key: string | null; logo_version: number }>('select logo_key, logo_version from tenant where id = $1', [tenantId])).rows[0]!;
const eventos = async (tenantId: string) =>
  (
    await env.migrator.query<{ payload: { data: { campos: string[] } } }>(
      "select payload from outbox where type = 'consultorio.actualizado' and tenant_id = $1 order by event_id",
      [tenantId],
    )
  ).rows.map((r) => r.payload.data.campos);

beforeAll(async () => {
  minio = await startMinio();
  await asegurarBucket(minio.config);
  const real = crearAlmacenS3(minio.config);
  almacen = {
    ...real,
    borrar: (llave) => (borradoCaido ? Promise.reject(new Error('borrado caído')) : real.borrar(llave)),
    guardar: (llave, bytes, tipo) => {
      guardadas.push(llave);
      return real.guardar(llave, bytes, tipo);
    },
  };
  env = await prepararBase();
  app = await servidor(env, undefined, almacen);
  a = await crearConsultorio(app, 'logo-a');
  b = await crearConsultorio(app, 'logo-b');
  await agregarMiembro(app, a, 'recepcion@logo.mx', 'recepcion');
  tokenRecepcion = await tokenDe(app, 'recepcion@logo.mx', a.tenantId, { mfa: false });
}, 180_000);
afterAll(async () => {
  await app?.close();
  await env?.stop();
  await minio?.stop();
});

describe('logo del consultorio', () => {
  test('admin sube logo: 200, logoVersion 1, objeto en MinIO y GET /consultorio/logo devuelve el PNG', async () => {
    const jpeg = await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#112233' } }).jpeg().toBuffer();
    const r = await put(jpeg, a.adminToken, 'image/jpeg');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ logoVersion: 1 });
    const { logo_key } = await fila(a.tenantId);
    expect(logo_key).toMatch(new RegExp(`^logos/${a.tenantId}/[0-9a-f-]{36}\\.png$`));
    expect(await almacen.leer(logo_key!)).not.toBeNull();
    expect(await eventos(a.tenantId)).toEqual([['logo']]);

    const g = await getLogo();
    expect(g.statusCode).toBe(200);
    expect(g.headers['content-type']).toBe('image/png');
    expect(g.headers['cache-control']).toBe('private, max-age=86400');
    const m = await sharp(g.rawPayload).metadata();
    expect({ formato: m.format, w: m.width, h: m.height }).toEqual({ formato: 'png', w: 512, h: 256 });
    expect(consultorioSchema.parse((await getConsultorio()).json()).logoVersion).toBe(1);
  });

  test('reemplazar el logo borra el objeto anterior', async () => {
    const antes = (await fila(a.tenantId)).logo_key!;
    const r = await put(await png());
    expect(r.json()).toEqual({ logoVersion: 2 });
    const despues = (await fila(a.tenantId)).logo_key!;
    expect(despues).not.toBe(antes);
    expect(await almacen.leer(antes)).toBeNull();
    expect(await almacen.leer(despues)).not.toBeNull();
  });

  test('Review Focus 1: dos subidas simultáneas → queda una sola llave, existe, y la versión avanza 2', async () => {
    const inicio = guardadas.length;
    const versionAntes = (await fila(a.tenantId)).logo_version;
    const [r1, r2] = await Promise.all([put(await png(30, 30)), put(await png(31, 31))]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    const nuevas = guardadas.slice(inicio);
    expect(nuevas).toHaveLength(2);
    const { logo_key, logo_version } = await fila(a.tenantId);
    expect(logo_version).toBe(versionAntes + 2);
    expect(nuevas).toContain(logo_key);
    const existentes = (await Promise.all(nuevas.map(async (k) => ((await almacen.leer(k)) ? k : null)))).filter(Boolean);
    expect(existentes).toEqual([logo_key]);
  });

  test('Review Focus 2: un archivo .png que en realidad es SVG/HTML → 400 y nada guardado', async () => {
    const inicio = guardadas.length;
    for (const cuerpo of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<html><script>alert(1)</script></html>']) {
      const r = await put(Buffer.from(cuerpo));
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ code: 'VALIDACION', message: 'Sube una imagen PNG, JPG o WebP' });
    }
    expect(guardadas).toHaveLength(inicio);
  });

  test('GIF, SVG, BMP o JSON subidos como imagen → 400 con el texto de la spec y nada guardado', async () => {
    const inicio = guardadas.length;
    const gif = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000000' } }).gif().toBuffer();
    const casos: [Buffer, string][] = [
      [gif, 'image/gif'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'],
      [Buffer.from('BMbmp'), 'image/bmp'],
      [gif, 'application/octet-stream'],
      [Buffer.from('{}'), 'application/json'],
    ];
    for (const [cuerpo, tipo] of casos) {
      const r = await put(cuerpo, a.adminToken, tipo);
      expect(r.statusCode, tipo).toBe(400);
      expect(r.json(), tipo).toMatchObject({ code: 'VALIDACION', message: 'Sube una imagen PNG, JPG o WebP' });
    }
    expect(guardadas).toHaveLength(inicio);
  });

  test('imagen corrupta con firma PNG válida → 400 y nada guardado', async () => {
    const inicio = guardadas.length;
    const corrupto = Buffer.concat([(await png()).subarray(0, 30), Buffer.from('basura')]);
    expect((await put(corrupto)).statusCode).toBe(400);
    expect(guardadas).toHaveLength(inicio);
  });

  test('archivo de 1.5 MB → 400 "El logo debe pesar menos de 1 MB"', async () => {
    const r = await put(Buffer.concat([await png(), Buffer.alloc(1_500_000)]));
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: 'VALIDACION', message: 'El logo debe pesar menos de 1 MB' });
  });

  test('cuerpo de más de 2 MB → 400 con el mismo texto de "menos de 1 MB"', async () => {
    const r = await put(Buffer.concat([await png(), Buffer.alloc(2_200_000)]));
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ code: 'VALIDACION', message: 'El logo debe pesar menos de 1 MB', details: { campo: 'logo' } });
  });

  test('Review Focus 4: cada token obtiene solo los bytes de su propio logo, nunca los del otro consultorio', async () => {
    const verde = await sharp({ create: { width: 64, height: 32, channels: 3, background: { r: 20, g: 160, b: 40 } } }).png().toBuffer();
    expect((await put(verde, b.adminToken)).statusCode).toBe(200);

    const delA = await getLogo(a.adminToken);
    const delB = await getLogo(b.adminToken);
    expect([delA.statusCode, delB.statusCode]).toEqual([200, 200]);
    const bytesA = (await almacen.leer((await fila(a.tenantId)).logo_key!))!.bytes;
    const bytesB = (await almacen.leer((await fila(b.tenantId)).logo_key!))!.bytes;
    expect(Buffer.compare(bytesA, bytesB)).not.toBe(0);
    expect(Buffer.compare(delA.rawPayload, Buffer.from(bytesA))).toBe(0);
    expect(Buffer.compare(delB.rawPayload, Buffer.from(bytesB))).toBe(0);
    expect(Buffer.compare(delB.rawPayload, delA.rawPayload)).not.toBe(0);
    expect((await sharp(delB.rawPayload).metadata()).width).toBe(64);
    expect(consultorioSchema.parse((await getConsultorio(b.adminToken)).json()).logoVersion).toBe(1);
  });

  test('cualquier miembro lee el logo; recepción no admin → 403 en PUT, DELETE y PATCH', async () => {
    expect((await getLogo(tokenRecepcion)).statusCode).toBe(200);
    expect((await put(await png(), tokenRecepcion)).statusCode).toBe(403);
    expect((await del(tokenRecepcion)).statusCode).toBe(403);
    const p = await app.inject({ method: 'PATCH', url: '/consultorio/personalizacion', payload: { nombreComercial: 'Intruso' }, headers: conToken(tokenRecepcion) });
    expect(p.statusCode).toBe(403);
    expect((await getLogo()).statusCode).toBe(200);
  });

  test('sin token → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/consultorio/logo' })).statusCode).toBe(401);
  });

  test('si falla el borrado del objeto anterior, la subida igual responde 200 y conserva la nueva llave', async () => {
    borradoCaido = true;
    try {
      const r = await put(await png(10, 10));
      expect(r.statusCode).toBe(200);
      expect(await almacen.leer((await fila(a.tenantId)).logo_key!)).not.toBeNull();
    } finally {
      borradoCaido = false;
    }
  });

  test('quitar el logo: 204, borra el objeto, logoVersion 0 y 404 al pedirlo; quitar sin logo → 204 sin evento', async () => {
    const { logo_key } = await fila(a.tenantId);
    const antes = (await eventos(a.tenantId)).length;
    expect((await del()).statusCode).toBe(204);
    expect(await almacen.leer(logo_key!)).toBeNull();
    expect((await fila(a.tenantId)).logo_key).toBeNull();
    expect((await getLogo()).statusCode).toBe(404);
    expect(consultorioSchema.parse((await getConsultorio()).json()).logoVersion).toBe(0);
    expect(await eventos(a.tenantId)).toHaveLength(antes + 1);
    expect((await del()).statusCode).toBe(204);
    expect(await eventos(a.tenantId)).toHaveLength(antes + 1);
  });

  test('almacenamiento caído: GET /consultorio 200; GET y PUT del logo → 503 sin cambiar la base', async () => {
    expect((await put(await png())).statusCode).toBe(200);
    const versionAntes = (await fila(a.tenantId)).logo_version;
    await minio.stop();
    expect((await getConsultorio()).statusCode).toBe(200);
    const g = await getLogo();
    expect(g.statusCode).toBe(503);
    expect(g.json()).toMatchObject({ code: 'INTERNO', message: 'Servicio no disponible' });
    expect((await put(await png())).statusCode).toBe(503);
    expect((await fila(a.tenantId)).logo_version).toBe(versionAntes);
  }, 90_000);
});
