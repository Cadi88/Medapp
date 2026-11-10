import { execFileSync } from 'node:child_process';
import { GenericContainer, Wait } from 'testcontainers';

export interface TestNats {
  url: string;
  stop(): Promise<void>;
  /** Congela el contenedor (simula NATS caído: las conexiones se cuelgan, no se cierran). */
  pause(): Promise<void>;
  unpause(): Promise<void>;
}

/**
 * NATS 2 con JetStream efímero. pause/unpause usan `docker pause|unpause <id>` vía child_process,
 * porque la API de Testcontainers no expone pause; el CLI de docker ya es requisito de Testcontainers.
 */
export async function startNats(): Promise<TestNats> {
  const container = await new GenericContainer('nats:2')
    .withCommand(['-js'])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
    .start();
  const id = container.getId();
  return {
    url: `nats://${container.getHost()}:${container.getMappedPort(4222)}`,
    stop: async () => {
      await container.stop();
    },
    pause: async () => {
      execFileSync('docker', ['pause', id], { stdio: 'ignore' });
    },
    unpause: async () => {
      execFileSync('docker', ['unpause', id], { stdio: 'ignore' });
    },
  };
}
