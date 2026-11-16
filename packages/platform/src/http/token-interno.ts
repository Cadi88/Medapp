import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from './errors.js';

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
  return async (request) => {
    const recibido = request.headers['x-token-interno'];
    if (typeof recibido !== 'string' || !coincide(recibido, token)) throw noEncontrado();
  };
}

/** GET interno entre servicios con `x-token-interno`; status ≠ 200 o cuerpo que no cumple `esquema` → Error. */
export async function llamarInterno<T>(base: string, ruta: string, token: string, esquema: z.ZodType<T>, timeoutMs = 3000): Promise<T> {
  const res = await fetch(base.replace(/\/+$/, '') + ruta, {
    headers: { 'x-token-interno': token },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status !== 200) throw new Error(`Llamada interna ${ruta} respondió ${res.status}`);
  return esquema.parse(await res.json());
}
