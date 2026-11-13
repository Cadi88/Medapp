import { GenericContainer, Wait } from 'testcontainers';
import type { ConfigAlmacen } from '../almacen/almacen.js';

export interface TestMinio {
  config: ConfigAlmacen;
  stop(): Promise<void>;
}

const USUARIO = 'minio_test';
const CLAVE = 'minio_test_pw_123';

/** MinIO efímero (misma imagen que docker-compose.yml). */
export async function startMinio(): Promise<TestMinio> {
  const container = await new GenericContainer('cgr.dev/chainguard/minio:latest')
    .withUser('root')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: USUARIO, MINIO_ROOT_PASSWORD: CLAVE })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000).forStatusCode(200))
    .start();
  return {
    config: {
      bucket: 'test-almacen',
      region: 'us-east-1',
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      accessKeyId: USUARIO,
      secretAccessKey: CLAVE,
    },
    stop: async () => {
      await container.stop();
    },
  };
}
