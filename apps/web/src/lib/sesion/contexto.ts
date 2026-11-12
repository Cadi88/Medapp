import 'server-only';
import { consultorioSchema, type Consultorio, type TokenClaims } from '@consultorio/contracts';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ipDelCliente, llamarGateway } from '@/lib/api/gateway';
import { leerToken } from './cookies';
import { destinoPorError } from './desvios';
import { claimsDelToken } from './token';

export interface Contexto {
  claims: TokenClaims;
  consultorio: Consultorio;
}

/**
 * Usuario y consultorio de la petición, para Server Components. El proxy normalmente ya renovó el token;
 * `cache()` hace una sola llamada al gateway por petición aunque varios componentes lo pidan.
 */
export const obtenerContexto = cache(async (): Promise<Contexto> => {
  const token = await leerToken();
  // Sin token el proxy no pudo renovarlo (p. ej. gateway caído) pero la sesión puede seguir vigente:
  // va a la frontera de error (con reintento), no a /login.
  if (!token) throw new Error('Sin token del consultorio: no se pudo renovar la sesión');
  const r = await llamarGateway('/api/identidad/consultorio', {
    auth: 'token',
    esquema: consultorioSchema,
    ip: ipDelCliente(await headers()),
  });
  if (!r.ok) {
    const destino = destinoPorError(r.error, r.status);
    if (destino) redirect(destino);
    throw new Error(`No se pudo cargar el consultorio (${r.status})`);
  }
  return { claims: claimsDelToken(token), consultorio: r.datos };
});
