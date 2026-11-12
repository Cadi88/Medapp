import 'server-only';
import { miembrosRespuestaSchema, type Miembro } from '@consultorio/contracts';
import { headers } from 'next/headers';
import { ipDelCliente, llamarGateway } from '@/lib/api/gateway';
import type { Resultado } from '@/lib/api/resultado';

const MIEMBROS = '/api/identidad/miembros';

async function ipActual(): Promise<string | undefined> {
  return ipDelCliente(await headers());
}

export async function listarMiembros(): Promise<Resultado<Miembro[]>> {
  const r = await llamarGateway(MIEMBROS, { auth: 'token', esquema: miembrosRespuestaSchema, ip: await ipActual() });
  return r.ok ? { ...r, datos: r.datos.miembros } : r;
}

export const altaMiembroEnApi = async (cuerpo: unknown) =>
  llamarGateway(MIEMBROS, { metodo: 'POST', cuerpo, auth: 'token', ip: await ipActual() });

export const editarMiembroEnApi = async (id: string, cuerpo: unknown) =>
  llamarGateway(`${MIEMBROS}/${encodeURIComponent(id)}`, { metodo: 'PATCH', cuerpo, auth: 'token', ip: await ipActual() });

export const reiniciarPasswordEnApi = async (id: string, cuerpo: unknown) =>
  llamarGateway(`${MIEMBROS}/${encodeURIComponent(id)}/password-temporal`, { metodo: 'POST', cuerpo, auth: 'token', ip: await ipActual() });

export const quitarMiembroEnApi = async (id: string) =>
  llamarGateway(`${MIEMBROS}/${encodeURIComponent(id)}`, { metodo: 'DELETE', auth: 'token', ip: await ipActual() });
