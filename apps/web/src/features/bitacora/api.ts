import 'server-only';
import { headers } from 'next/headers';
import { ipDelCliente, llamarGateway } from '@/lib/api/gateway';
import type { Resultado } from '@/lib/api/resultado';
import { paginaEventosSchema, type ConsultaBitacora, type PaginaEventos } from './tipos';

/** `antesDe`: `siguiente` de la página anterior (cursor por `secuencia`). */
export async function listarEventos(consulta: ConsultaBitacora & { antesDe?: number }): Promise<Resultado<PaginaEventos>> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(consulta)) if (v !== undefined) q.set(k, String(v));
  const texto = q.toString();
  return llamarGateway(`/api/auditoria/eventos${texto ? `?${texto}` : ''}`, {
    auth: 'token',
    esquema: paginaEventosSchema,
    ip: ipDelCliente(await headers()),
  });
}
