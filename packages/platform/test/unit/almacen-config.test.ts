import { describe, expect, test } from 'vitest';
import { asegurarBucket, configAlmacenDesdeEnv, crearAlmacenS3 } from '../../src/index.js';

describe('configAlmacenDesdeEnv', () => {
  test('sin S3_ENDPOINT no exige credenciales', () => {
    expect(configAlmacenDesdeEnv({ S3_BUCKET: 'b', S3_REGION: 'us-east-1' })).toEqual({
      bucket: 'b',
      region: 'us-east-1',
    });
  });

  test('con S3_ENDPOINT sin credenciales → error', () => {
    expect(() =>
      configAlmacenDesdeEnv({ S3_BUCKET: 'b', S3_REGION: 'r', S3_ENDPOINT: 'http://x:9000' }),
    ).toThrow();
    expect(() =>
      configAlmacenDesdeEnv({
        S3_BUCKET: 'b',
        S3_REGION: 'r',
        S3_ENDPOINT: 'http://x:9000',
        S3_ACCESS_KEY_ID: 'a',
      }),
    ).toThrow();
  });

  test('con endpoint y credenciales las devuelve', () => {
    expect(
      configAlmacenDesdeEnv({
        S3_BUCKET: 'b',
        S3_REGION: 'r',
        S3_ENDPOINT: 'http://x:9000',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
      }),
    ).toEqual({
      bucket: 'b',
      region: 'r',
      endpoint: 'http://x:9000',
      accessKeyId: 'a',
      secretAccessKey: 's',
    });
  });

  test('S3_BUCKET y S3_REGION son obligatorias', () => {
    expect(() => configAlmacenDesdeEnv({ S3_REGION: 'r' })).toThrow();
    expect(() => configAlmacenDesdeEnv({ S3_BUCKET: 'b' })).toThrow();
  });

  test('crearAlmacenS3 construye el cliente sin red; asegurarBucket sin endpoint no hace nada', async () => {
    const c = { bucket: 'b', region: 'us-east-1' };
    expect(crearAlmacenS3(c)).toHaveProperty('guardar');
    await expect(asegurarBucket(c)).resolves.toBeUndefined();
  });
});
