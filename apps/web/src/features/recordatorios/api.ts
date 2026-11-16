import 'server-only';
import {
  aprobarRangoRespuestaSchema,
  configRecordatoriosSchema,
  enlaceWhatsAppSchema,
  estadoCorreoRespuestaSchema,
  recordatoriosRespuestaSchema,
  respuestaRegistradaSchema,
  type AbrirWhatsApp,
  type ActualizarConfigRecordatorios,
  type RangoRecordatorios,
  type RegistrarRespuestaRecepcion,
} from '@consultorio/contracts';
import { headers } from 'next/headers';
import { ipDelCliente, llamarGateway } from '@/lib/api/gateway';

const NOTIFICACIONES = '/api/notificaciones';
const RECORDATORIOS = `${NOTIFICACIONES}/recordatorios`;

async function ipActual(): Promise<string | undefined> {
  return ipDelCliente(await headers());
}

const rutaDeCita = (citaId: string, accion: string) => `${RECORDATORIOS}/${encodeURIComponent(citaId)}/${accion}`;

/** `desde`/`hasta`: fechas locales del consultorio (`YYYY-MM-DD`), como máximo 7 días. */
export async function listarRecordatorios(desde: string, hasta: string) {
  const q = new URLSearchParams({ desde, hasta });
  return llamarGateway(`${RECORDATORIOS}?${q}`, { auth: 'token', esquema: recordatoriosRespuestaSchema, ip: await ipActual() });
}

export const aprobarEnApi = async (citaId: string) => llamarGateway(rutaDeCita(citaId, 'aprobar'), { metodo: 'POST', auth: 'token', esquema: estadoCorreoRespuestaSchema, ip: await ipActual() });

export const aprobarRangoEnApi = async (rango: RangoRecordatorios) =>
  llamarGateway(`${RECORDATORIOS}/aprobar`, { metodo: 'POST', cuerpo: rango, auth: 'token', esquema: aprobarRangoRespuestaSchema, ip: await ipActual() });

export const reintentarEnApi = async (citaId: string) => llamarGateway(rutaDeCita(citaId, 'reintentar'), { metodo: 'POST', auth: 'token', esquema: estadoCorreoRespuestaSchema, ip: await ipActual() });

/** Registra "WhatsApp abierto" y devuelve el enlace `wa.me` con el mensaje ya rellenado. */
export const abrirWhatsAppEnApi = async (citaId: string, cuerpo: AbrirWhatsApp) =>
  llamarGateway(rutaDeCita(citaId, 'whatsapp'), { metodo: 'POST', cuerpo, auth: 'token', esquema: enlaceWhatsAppSchema, ip: await ipActual() });

export const registrarRespuestaEnApi = async (citaId: string, cuerpo: RegistrarRespuestaRecepcion) =>
  llamarGateway(rutaDeCita(citaId, 'respuesta'), { metodo: 'POST', cuerpo, auth: 'token', esquema: respuestaRegistradaSchema, ip: await ipActual() });

export const obtenerConfig = async () => llamarGateway(`${NOTIFICACIONES}/config`, { auth: 'token', esquema: configRecordatoriosSchema, ip: await ipActual() });

export const actualizarConfigEnApi = async (cuerpo: ActualizarConfigRecordatorios) =>
  llamarGateway(`${NOTIFICACIONES}/config`, { metodo: 'PUT', cuerpo, auth: 'token', esquema: configRecordatoriosSchema, ip: await ipActual() });
