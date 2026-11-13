import { z } from 'zod';

/** Almacenamiento de objetos (archivos) detrás de una interfaz mínima; la implementación es S3/MinIO. */
export interface Almacen {
  guardar(llave: string, bytes: Uint8Array, tipo: string): Promise<void>;
  /** `null` si la llave no existe. */
  leer(llave: string): Promise<{ bytes: Uint8Array; tipo: string } | null>;
  /** Borrar una llave inexistente no falla. */
  borrar(llave: string): Promise<void>;
}

export interface ConfigAlmacen {
  bucket: string;
  region: string;
  /** Solo para MinIO/local; en AWS se omite y se usan las credenciales del entorno. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

const EnvSchema = z
  .object({
    S3_BUCKET: z.string().min(1),
    S3_REGION: z.string().min(1),
    S3_ENDPOINT: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  })
  .refine((e) => !e.S3_ENDPOINT || (e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY), {
    message: 'S3_ENDPOINT requiere S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY',
  });

export function configAlmacenDesdeEnv(env: Record<string, string | undefined>): ConfigAlmacen {
  const e = EnvSchema.parse(env);
  const config: ConfigAlmacen = { bucket: e.S3_BUCKET, region: e.S3_REGION };
  if (e.S3_ENDPOINT) {
    config.endpoint = e.S3_ENDPOINT;
    config.accessKeyId = e.S3_ACCESS_KEY_ID;
    config.secretAccessKey = e.S3_SECRET_ACCESS_KEY;
  }
  return config;
}
