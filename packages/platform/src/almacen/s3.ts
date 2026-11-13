import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { Almacen, ConfigAlmacen } from './almacen.js';

/** Sin tiempos límite un almacenamiento colgado dejaría colgadas las solicitudes del servicio. */
const CONEXION_MS = 2000;
const SOLICITUD_MS = 5000;

export function crearCliente(c: ConfigAlmacen): S3Client {
  return new S3Client({
    region: c.region,
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({ connectionTimeout: CONEXION_MS, requestTimeout: SOLICITUD_MS }),
    ...(c.endpoint
      ? {
          endpoint: c.endpoint,
          forcePathStyle: true,
          credentials: { accessKeyId: c.accessKeyId ?? '', secretAccessKey: c.secretAccessKey ?? '' },
        }
      : {}),
  });
}

function esError(e: unknown, nombres: string[], status?: number): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    (err.name !== undefined && nombres.includes(err.name)) ||
    (status !== undefined && err.$metadata?.httpStatusCode === status)
  );
}

export function crearAlmacenS3(c: ConfigAlmacen): Almacen {
  const s3 = crearCliente(c);
  return {
    async guardar(llave, bytes, tipo) {
      await s3.send(new PutObjectCommand({ Bucket: c.bucket, Key: llave, Body: bytes, ContentType: tipo }));
    },
    async leer(llave) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: c.bucket, Key: llave }));
        const bytes = (await r.Body?.transformToByteArray()) ?? new Uint8Array();
        return { bytes, tipo: r.ContentType ?? 'application/octet-stream' };
      } catch (e) {
        if (esError(e, ['NoSuchKey'], 404)) return null;
        throw e;
      }
    },
    async borrar(llave) {
      await s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: llave }));
    },
  };
}

/** Crea el bucket si no existe (solo con endpoint, es decir MinIO/local). Idempotente y seguro bajo concurrencia. */
export async function asegurarBucket(c: ConfigAlmacen): Promise<void> {
  if (!c.endpoint) return;
  const s3 = crearCliente(c);
  try {
    await s3.send(new HeadBucketCommand({ Bucket: c.bucket }));
    return;
  } catch (e) {
    if (!esError(e, ['NotFound', 'NoSuchBucket'], 404)) throw e;
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: c.bucket }));
  } catch (e) {
    if (!esError(e, ['BucketAlreadyOwnedByYou'])) throw e;
  }
}
