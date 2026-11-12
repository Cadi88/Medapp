import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ipDelCliente } from '@/lib/api/gateway';
import { destinoPorError } from '@/lib/sesion/desvios';
import { consultoriosDelUsuario } from './api';
import type { ConsultorioDelUsuario } from './tipos';

/**
 * Consultorios entre los que puede elegir el usuario (para la pantalla de elección). Sin sesión → `/login`;
 * sin consultorios → `/sin-acceso`; cualquier otro error lo recoge la frontera de error de la página.
 */
export async function consultoriosParaElegir(): Promise<ConsultorioDelUsuario[]> {
  const r = await consultoriosDelUsuario(ipDelCliente(await headers()));
  if (!r.ok) {
    const destino = destinoPorError(r.error, r.status);
    if (destino) redirect(destino);
    throw new Error(r.error.message);
  }
  if (r.datos.length === 0) redirect('/sin-acceso');
  return r.datos;
}
