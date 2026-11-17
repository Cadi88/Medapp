import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK } from '@opentelemetry/sdk-node';
import pino from 'pino';

/** Enmascara el segmento que sigue a `/respuestas/` (el token de respuesta del paciente es una credencial); conserva el resto de la URL. */
export function ocultarTokenEnUrl(url: string): string {
  return url.replace(/(\/respuestas\/)[^/?#]+/g, '$1[oculto]');
}

/**
 * Atributos que sustituyen a los del span entrante: instrumentation-http (convenciones estables) fija `url.path` con la ruta
 * tal cual y mezcla estos encima, así que ahí va la ruta sin el token. La consulta no lleva el token y la gestiona la propia instrumentación.
 */
export function atributosDeSpanEntrante(req: { url?: string }): { 'url.path': string } {
  const ruta = (req.url ?? '').split(/[?#]/, 1)[0] ?? '';
  return { 'url.path': ocultarTokenEnUrl(ruta) };
}

interface ReqLike {
  method?: string;
  url?: string;
  host?: string;
  ip?: string;
  headers?: Record<string, unknown>;
  socket?: { remotePort?: number };
}

/** Mismo formato que el serializador de Fastify, pero sin tokens en la URL. */
export function serializarReq(req: ReqLike): Record<string, unknown> {
  return {
    method: req.method,
    url: typeof req.url === 'string' ? ocultarTokenEnUrl(req.url) : req.url,
    version: req.headers?.['accept-version'],
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

/**
 * Logger JSON con binding `servicio`, nivel por `LOG_LEVEL` (default `info`) y
 * redacción de Authorization/Cookie. `destination` solo se usa en pruebas.
 */
export function createLogger(servicio: string, destination?: pino.DestinationStream): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      base: { servicio },
      serializers: { req: serializarReq },
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
    instrumentations: [
      new HttpInstrumentation({
        // El token de /respuestas/{token} no debe viajar en los atributos de las trazas.
        startIncomingSpanHook: (req) => atributosDeSpanEntrante(req as { url?: string }),
      }),
      new FastifyInstrumentation(),
      new PgInstrumentation(),
    ],
  });
  sdk.start();
}

/** Cierra el SDK (apagado ordenado); permite reiniciar con `initTelemetry`. */
export async function shutdownTelemetry(): Promise<void> {
  const s = sdk;
  sdk = undefined;
  if (s) await s.shutdown();
}
