import type { ErrorCode } from '@consultorio/contracts';
import { ZodError } from 'zod';

/** Error de negocio con código del contrato; el handler lo serializa tal cual. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface MappedError {
  status: number;
  body: { code: ErrorCode; message: string; details?: unknown };
  /** true si es un fallo inesperado que debe registrarse con stack. */
  unexpected: boolean;
}

interface FastifyLikeError {
  statusCode?: number;
  code?: string;
  validation?: { instancePath?: string; params?: { missingProperty?: unknown } }[];
}

function camposFastify(validation: NonNullable<FastifyLikeError['validation']>): { campo: string }[] {
  return validation.map((v) => {
    const missing = v.params?.missingProperty;
    const base = (v.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.');
    const campo = typeof missing === 'string' ? (base ? `${base}.${missing}` : missing) : base;
    return { campo };
  });
}

/**
 * Traduce cualquier error al formato único `{ code, message, details? }`.
 * Los detalles de validación solo llevan rutas de campo, nunca datos internos.
 */
export function mapError(err: unknown): MappedError {
  if (err instanceof AppError) {
    const body: MappedError['body'] = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return { status: err.status, body, unexpected: false };
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ campo: i.path.join('.') }));
    return { status: 400, body: { code: 'VALIDACION', message: 'Solicitud inválida', details }, unexpected: false };
  }
  const e = err as FastifyLikeError | null;
  if (e && typeof e === 'object') {
    if (Array.isArray(e.validation)) {
      return {
        status: 400,
        body: { code: 'VALIDACION', message: 'Solicitud inválida', details: camposFastify(e.validation) },
        unexpected: false,
      };
    }
    // Errores propios de Fastify por culpa del cliente (JSON inválido, cuerpo grande, media type...).
    if (
      typeof e.code === 'string' &&
      e.code.startsWith('FST_') &&
      e.statusCode &&
      e.statusCode >= 400 &&
      e.statusCode < 500
    ) {
      return { status: e.statusCode, body: { code: 'VALIDACION', message: 'Solicitud inválida' }, unexpected: false };
    }
  }
  return { status: 500, body: { code: 'INTERNO', message: 'Error interno' }, unexpected: true };
}
