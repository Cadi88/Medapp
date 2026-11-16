import 'server-only';
import { configRecordatoriosSchema, recordatoriosRespuestaSchema, type RangoRecordatorios } from '@consultorio/contracts';
import { headers } from 'next/headers';
import { z } from 'zod';
import { ipDelCliente, llamarGateway } from '@/lib/api/gateway';

const NOTIFICACIONES = '/api/notificaciones';
const RECORDATORIOS = `${NOTIFICACIONES}/recordatorios`;

const enlaceWhatsAppSchema = z.object({ enlace: z.string() });

async function ipActual(): Promise<string | undefined> {
  return ipDelCliente(await headers());
}

const rutaDeCita = (citaId: string, accion: string) => `${RECORDATORIOS}/${encodeURIComponent(citaId)}/${accion}`;

/** `desde`/`hasta`: fechas locales del consultorio (`YYYY-MM-DD`), como máximo 7 días. */
export async function listarRecordatorios(desde: string, hasta: string) {
  const q = new URLSearchParams({ desde, hasta });
  return llamarGateway(`${RECORDATORIOS}?${q}`, { auth: 'token', esquema: recordatoriosRespuestaSchema, ip: await ipActual() });
}

export const aprobarEnApi = async (citaId: string) => llamarGateway(rutaDeCita(citaId, 'aprobar'), { metodo: 'POST', auth: 'token', ip: await ipActual() });

export const aprobarRangoEnApi = async (rango: RangoRecordatorios) =>
  llamarGateway(`${RECORDATORIOS}/aprobar`, { metodo: 'POST', cuerpo: rango, auth: 'token', ip: await ipActual() });

export const reintentarEnApi = async (citaId: string) => llamarGateway(rutaDeCita(citaId, 'reintentar'), { metodo: 'POST', auth: 'token', ip: await ipActual() });

/** Registra "WhatsApp abierto" y devuelve el enlace `wa.me` con el mensaje ya rellenado. */
export const abrirWhatsAppEnApi = async (citaId: string, cuerpo: { fecha: string }) =>
  llamarGateway(rutaDeCita(citaId, 'whatsapp'), { metodo: 'POST', cuerpo, auth: 'token', esquema: enlaceWhatsAppSchema, ip: await ipActual() });

export const registrarRespuestaEnApi = async (citaId: string, cuerpo: { fecha: string; respuesta: string }) =>
  llamarGateway(rutaDeCita(citaId, 'respuesta'), { metodo: 'POST', cuerpo, auth: 'token', ip: await ipActual() });

export const obtenerConfig = async () => llamarGateway(`${NOTIFICACIONES}/config`, { auth: 'token', esquema: configRecordatoriosSchema, ip: await ipActual() });

export const actualizarConfigEnApi = async (cuerpo: unknown) =>
  llamarGateway(`${NOTIFICACIONES}/config`, { metodo: 'PUT', cuerpo, auth: 'token', esquema: configRecordatoriosSchema, ip: await ipActual() });
