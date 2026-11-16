import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from './errors.js';

/** Longitud mínima del token interno. */
export const TOKEN_MIN = 32;
const noEncontrado = (): AppError => new AppError('NO_ENCONTRADO', 'No encontrado', 404);

function coincide(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  // timingSafeEqual exige longitudes iguales; una longitud distinta nunca coincide.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * preHandler de las rutas `/interno/*`: exige la cabecera `x-token-interno` igual a `token` (tiempo constante).
 * Si no coincide responde 404 (la ruta no se revela). Las rutas que lo usan deben ir en `rutasPublicas` del plugin JWT.
 */
export function requireTokenInterno(token: string): (request: Pick<FastifyRequest, 'headers'>) => Promise<void> {
  // Falla cerrado: un token vacío o corto aceptaría una cabecera vacía o adivinable.
  if (token.length < TOKEN_MIN) throw new Error(`TOKEN_INTERNO debe tener al menos ${TOKEN_MIN} caracteres`);
  return async (request) => {
    const recibido = request.headers['x-token-interno'];
    if (typeof recibido !== 'string' || !coincide(recibido, token)) throw noEncontrado();
  };
}

/**
 * Plugin encapsulado para las rutas `/interno/*`: el token se exige con un hook `preHandler` del plugin, así que
 * ninguna ruta registrada dentro puede olvidarlo. El servicio debe listar `/interno/*` en `rutasPublicas`.
 */
export function rutasInternas(token: string, registrar: FastifyPluginAsync): FastifyPluginAsync {
  const exigir = requireTokenInterno(token);
  return async (app) => {
    app.addHook('preHandler', exigir);
    await app.register(registrar);
  };
}

/** GET interno entre servicios con `x-token-interno`; status ≠ 200 o cuerpo que no cumple `esquema` → Error. */
export async function llamarInterno<T>(base: string, ruta: string, token: string, esquema: z.ZodType<T>, timeoutMs = 3000): Promise<T> {
  const res = await fetch(base.replace(/\/+$/, '') + ruta, {
    headers: { 'x-token-interno': token },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status !== 200) {
    await res.body?.cancel();
    throw new Error(`Llamada interna ${ruta} respondió ${res.status}`);
  }
  return esquema.parse(await res.json());
}
