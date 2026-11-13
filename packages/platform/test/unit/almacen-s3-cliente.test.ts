import { NodeHttpHandler } from '@smithy/node-http-handler';
import { describe, expect, test } from 'vitest';
import { crearCliente } from '../../src/almacen/s3.js';

describe('crearCliente (S3)', () => {
  test.each([
    ['con endpoint (MinIO)', { bucket: 'b', region: 'us-east-1', endpoint: 'http://x:9000', accessKeyId: 'a', secretAccessKey: 's' }],
    ['sin endpoint (AWS)', { bucket: 'b', region: 'us-east-1' }],
  ])('%s: tiempos límite de conexión y de solicitud y 2 intentos', async (_n, config) => {
    const cliente = crearCliente(config);
    const manejador = cliente.config.requestHandler as NodeHttpHandler;
    expect(manejador).toBeInstanceOf(NodeHttpHandler);
    const opciones = await (manejador as unknown as { configProvider: Promise<{ connectionTimeout?: number; requestTimeout?: number }> }).configProvider;
    expect(opciones.connectionTimeout).toBe(2000);
    expect(opciones.requestTimeout).toBe(5000);
    expect(await cliente.config.maxAttempts()).toBe(2);
  });
});
