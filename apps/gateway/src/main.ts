import { createLogger, initTelemetry, shutdownTelemetry } from '@consultorio/platform';
import { leerConfig } from './config.js';
import { buildGateway } from './server.js';

// Única lectura de variables de entorno del servicio (la telemetría OTEL la lee initTelemetry).
const cfg = leerConfig(process.env);

initTelemetry('gateway');
const logger = createLogger('gateway');
const app = await buildGateway({
  jwksUrl: cfg.jwksUrl,
  destinos: cfg.destinos,
  confiarEnProxy: cfg.confiarEnProxy,
  limitePublicoPorMin: cfg.limitePublicoPorMin,
});

let apagando = false;
const apagar = async (): Promise<void> => {
  if (apagando) return;
  apagando = true;
  const pasos: [string, () => Promise<unknown>][] = [
    ['servidor HTTP', () => app.close()],
    ['telemetría', () => shutdownTelemetry()],
  ];
  for (const [nombre, paso] of pasos) {
    try {
      await paso();
    } catch (err) {
      logger.error({ err }, `error al cerrar ${nombre}`);
    }
  }
};
for (const s of ['SIGTERM', 'SIGINT'] as const) {
  process.once(s, () => {
    void apagar().finally(() => process.exit(0));
  });
}

await app.listen({ port: cfg.port, host: '0.0.0.0' });
