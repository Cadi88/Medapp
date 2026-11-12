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
 * Usuario y consultorio de la petición, para Server Components. El proxy ya garantizó un token vigente;
 * `cache()` hace una sola llamada al gateway por petición aunque varios componentes lo pidan.
 */
export const obtenerContexto = cache(async (): Promise<Contexto> => {
  const token = await leerToken();
  if (!token) redirect('/login');
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
