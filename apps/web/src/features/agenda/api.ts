import 'server-only';
import {
  citaSchema,
  disponibilidadSchema,
  medicoAgendaSchema,
  tipoCitaSchema,
  type Cita,
  type MedicoAgenda,
  type TipoCita,
} from '@consultorio/contracts';
import { headers } from 'next/headers';
import { z } from 'zod';
import { ipDelCliente, llamarGateway } from '@/lib/api/gateway';
import type { Resultado } from '@/lib/api/resultado';

const AGENDA = '/api/agenda';

const medicosSchema = z.object({ medicos: z.array(medicoAgendaSchema) });
const tiposSchema = z.object({ tiposCita: z.array(tipoCitaSchema) });
const citasSchema = z.object({ citas: z.array(citaSchema) });

async function ipActual(): Promise<string | undefined> {
  return ipDelCliente(await headers());
}

/** Misma respuesta (o el mismo error) con `datos` transformados. */
function mapear<T, U>(r: Resultado<T>, f: (d: T) => U): Resultado<U> {
  return r.ok ? { ...r, datos: f(r.datos) } : r;
}

/** Admin y recepción: todos los médicos activos; un médico: solo él mismo. */
export async function listarMedicos(): Promise<Resultado<MedicoAgenda[]>> {
  const r = await llamarGateway(`${AGENDA}/medicos`, { auth: 'token', esquema: medicosSchema, ip: await ipActual() });
  return mapear(r, (d) => d.medicos);
}

/** Con `todos`, también los inactivos (las citas viejas pueden referirse a un tipo ya desactivado). */
export async function listarTiposCita(medicoId: string, todos = false): Promise<Resultado<TipoCita[]>> {
  const q = todos ? '?todos=1' : '';
  const r = await llamarGateway(`${AGENDA}/medicos/${encodeURIComponent(medicoId)}/tipos-cita${q}`, {
    auth: 'token',
    esquema: tiposSchema,
    ip: await ipActual(),
  });
  return mapear(r, (d) => d.tiposCita);
}

/** `desde`/`hasta`: instantes ISO, rango máximo de 31 días. */
export async function listarCitas(desde: string, hasta: string, medicoId?: string): Promise<Resultado<Cita[]>> {
  const q = new URLSearchParams({ desde, hasta, ...(medicoId ? { medicoId } : {}) });
  const r = await llamarGateway(`${AGENDA}/citas?${q}`, { auth: 'token', esquema: citasSchema, ip: await ipActual() });
  return mapear(r, (d) => d.citas);
}

/** Inicios libres (ISO UTC) del día local `fecha` (`YYYY-MM-DD`). */
export async function obtenerDisponibilidad(medicoId: string, fecha: string, tipoCitaId: string): Promise<Resultado<string[]>> {
  const q = new URLSearchParams({ fecha, tipoCitaId });
  const r = await llamarGateway(`${AGENDA}/medicos/${encodeURIComponent(medicoId)}/disponibilidad?${q}`, {
    auth: 'token',
    esquema: disponibilidadSchema,
    ip: await ipActual(),
  });
  return mapear(r, (d) => d.huecos);
}

export const crearCitaEnApi = async (cuerpo: unknown) =>
  llamarGateway(`${AGENDA}/citas`, { metodo: 'POST', cuerpo, auth: 'token', esquema: citaSchema, ip: await ipActual() });

export const reprogramarCitaEnApi = async (id: string, cuerpo: unknown) =>
  llamarGateway(`${AGENDA}/citas/${encodeURIComponent(id)}`, { metodo: 'PATCH', cuerpo, auth: 'token', esquema: citaSchema, ip: await ipActual() });

export const cambiarEstadoEnApi = async (id: string, cuerpo: unknown) =>
  llamarGateway(`${AGENDA}/citas/${encodeURIComponent(id)}/estado`, { metodo: 'POST', cuerpo, auth: 'token', esquema: citaSchema, ip: await ipActual() });
