import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK } from '@opentelemetry/sdk-node';
import pino from 'pino';

/**
 * Logger JSON con binding `servicio`, nivel por `LOG_LEVEL` (default `info`) y
 * redacción de Authorization/Cookie. `destination` solo se usa en pruebas.
 */
export function createLogger(servicio: string, destination?: pino.DestinationStream): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      base: { servicio },
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[redacted]' },
    },
    destination,
  );
}

let sdk: NodeSDK | undefined;

/**
 * Inicia OpenTelemetry (trazas OTLP/HTTP) solo si existe `OTEL_EXPORTER_OTLP_ENDPOINT`.
 * Idempotente. Llamar lo antes posible en el arranque: las auto-instrumentaciones
 * (http, fastify, pg) solo parchean módulos cargados después de `start()`.
 */
export function initTelemetry(servicio: string): void {
  if (sdk || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  sdk = new NodeSDK({
    serviceName: servicio,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [new HttpInstrumentation(), new FastifyInstrumentation(), new PgInstrumentation()],
  });
  sdk.start();
}

/** Cierra el SDK (apagado ordenado); permite reiniciar con `initTelemetry`. */
export async function shutdownTelemetry(): Promise<void> {
  const s = sdk;
  sdk = undefined;
  if (s) await s.shutdown();
}
