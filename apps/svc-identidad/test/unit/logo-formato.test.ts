import sharp from 'sharp';
import { beforeAll, describe, expect, test } from 'vitest';
import { detectarFormato } from '../../src/dominio/logo.js';
import { procesarLogo } from '../../src/logo/procesar.js';

const fondo = { r: 30, g: 58, b: 138 };
const crear = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: fondo } });

let PNG_1PX: Buffer;
let JPEG_1PX: Buffer;
let WEBP_1PX: Buffer;
let GIF_1PX: Buffer;

beforeAll(async () => {
  PNG_1PX = await crear(1, 1).png().toBuffer();
  JPEG_1PX = await crear(1, 1).jpeg().toBuffer();
  WEBP_1PX = await crear(1, 1).webp().toBuffer();
  GIF_1PX = await crear(1, 1).gif().toBuffer();
});

describe('detectarFormato', () => {
  test.each([['png'], ['jpeg'], ['webp']] as const)('detecta %s', (f) => {
    const bytes = { png: PNG_1PX, jpeg: JPEG_1PX, webp: WEBP_1PX }[f];
    expect(detectarFormato(bytes)).toBe(f);
  });
  test.each([
    ['svg', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['gif', () => GIF_1PX],
    ['texto', () => Buffer.from('hola')],
    ['vacío', () => Buffer.alloc(0)],
    ['RIFF que no es WebP', () => Buffer.from('RIFF\0\0\0\0WAVE')],
    ['PNG truncado', () => PNG_1PX.subarray(0, 5)],
  ])('rechaza %s', (_n, bytes) => {
    expect(detectarFormato(bytes())).toBeNull();
  });
});

describe('procesarLogo', () => {
  test('reduce 2000x1000 a 512x256 PNG', async () => {
    const salida = await procesarLogo(await crear(2000, 1000).jpeg().toBuffer());
    const m = await sharp(salida).metadata();
    expect({ formato: m.format, w: m.width, h: m.height }).toEqual({ formato: 'png', w: 512, h: 256 });
  });
  test('no agranda una imagen de 100x100', async () => {
    const m = await sharp(await procesarLogo(await crear(100, 100).webp().toBuffer())).metadata();
    expect({ w: m.width, h: m.height }).toEqual({ w: 100, h: 100 });
  });
  test('descarta metadatos (EXIF)', async () => {
    const con = await crear(50, 50).withExif({ IFD0: { Copyright: 'secreto' } }).jpeg().toBuffer();
    expect((await sharp(con).metadata()).exif).toBeDefined();
    expect((await sharp(await procesarLogo(con)).metadata()).exif).toBeUndefined();
  });
  test('Review Focus 3: imagen de 12000x12000 (bomba de descompresión) → 400', async () => {
    const bomba = await sharp({ create: { width: 12000, height: 12000, channels: 3, background: fondo }, limitInputPixels: false }).greyscale().png({ compressionLevel: 9 }).toBuffer();
    expect(bomba.length).toBeLessThan(1024 * 1024);
    await expect(procesarLogo(bomba)).rejects.toMatchObject({ status: 400, message: 'Sube una imagen PNG, JPG o WebP' });
  }, 60_000);
  test('bytes corruptos con firma válida → 400', async () => {
    const corrupto = Buffer.concat([PNG_1PX.subarray(0, 20), Buffer.from('basura')]);
    await expect(procesarLogo(corrupto)).rejects.toMatchObject({ status: 400 });
  });
});
