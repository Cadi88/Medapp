import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asegurarBucket, crearAlmacenS3, type Almacen } from '../../src/index.js';
import { startMinio } from '../../src/testing/index.js';

describe('almacén S3 sobre MinIO', () => {
  let minio: Awaited<ReturnType<typeof startMinio>>;
  let almacen: Almacen;

  beforeAll(async () => {
    minio = await startMinio();
    await asegurarBucket(minio.config);
    almacen = crearAlmacenS3(minio.config);
  }, 120_000);
  afterAll(async () => {
    await minio?.stop();
  });

  test('guardar → leer devuelve los mismos bytes y tipo', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 7]);
    await almacen.guardar('logos/t1/a.png', bytes, 'image/png');
    const r = await almacen.leer('logos/t1/a.png');
    expect(r?.tipo).toBe('image/png');
    expect(Array.from(r?.bytes ?? [])).toEqual(Array.from(bytes));
  });

  test('leer una llave inexistente → null', async () => {
    expect(await almacen.leer('no/existe.png')).toBeNull();
  });

  test('borrar elimina y borrar una llave inexistente no falla', async () => {
    await almacen.guardar('x/borrar.bin', new Uint8Array([9]), 'application/octet-stream');
    await almacen.borrar('x/borrar.bin');
    expect(await almacen.leer('x/borrar.bin')).toBeNull();
    await expect(almacen.borrar('x/nunca.bin')).resolves.toBeUndefined();
  });

  test('asegurarBucket es idempotente, también en concurrencia', async () => {
    await asegurarBucket(minio.config);
    await asegurarBucket(minio.config);
    const nuevo = { ...minio.config, bucket: 'otro-bucket' };
    await Promise.all([asegurarBucket(nuevo), asegurarBucket(nuevo), asegurarBucket(nuevo)]);
    const a2 = crearAlmacenS3(nuevo);
    await a2.guardar('k', new Uint8Array([1]), 'text/plain');
    expect((await a2.leer('k'))?.tipo).toBe('text/plain');
  });
});
