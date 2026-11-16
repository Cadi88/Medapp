import 'server-only';
import { respuestaPublicaSchema, resultadoRespuestaSchema } from '@consultorio/contracts';
import { headers } from 'next/headers';
import { ipDelCliente, llamarGateway, type RespuestaBinaria } from '@/lib/api/gateway';
import type { Resultado } from '@/lib/api/resultado';

/** Rutas públicas del gateway: sin sesión; el token (ya validado en su forma) va en la ruta. */
const ruta = (token: string) => `/api/notificaciones/respuestas/${encodeURIComponent(token)}`;

async function ipActual(): Promise<string | undefined> {
  return ipDelCliente(await headers());
}

export const obtenerEnlacePublico = async (token: string) =>
  llamarGateway(ruta(token), { auth: 'ninguna', esquema: respuestaPublicaSchema, ip: await ipActual() });

export const registrarRespuestaEnApi = async (token: string, respuesta: string) =>
  llamarGateway(ruta(token), { metodo: 'POST', cuerpo: { respuesta }, auth: 'ninguna', esquema: resultadoRespuestaSchema, ip: await ipActual() });

export async function obtenerLogoPublico(token: string): Promise<Resultado<RespuestaBinaria>> {
  return llamarGateway<RespuestaBinaria>(`${ruta(token)}/logo`, { auth: 'ninguna', respuestaBinaria: true, ip: await ipActual() });
}
