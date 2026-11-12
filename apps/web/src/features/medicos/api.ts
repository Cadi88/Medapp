import 'server-only';
import { bloqueoSchema, semanaSchema, type Bloqueo, type BloqueHorarioDto } from '@consultorio/contracts';
import { headers } from 'next/headers';
import { z } from 'zod';
import { ipDelCliente, llamarGateway } from '@/lib/api/gateway';
import type { Resultado } from '@/lib/api/resultado';

const medico = (id: string) => `/api/agenda/medicos/${encodeURIComponent(id)}`;
const bloqueosSchema = z.object({ bloqueos: z.array(bloqueoSchema) });

async function ipActual(): Promise<string | undefined> {
  return ipDelCliente(await headers());
}

export async function leerHorario(medicoId: string): Promise<Resultado<BloqueHorarioDto[]>> {
  const r = await llamarGateway(`${medico(medicoId)}/horario`, { auth: 'token', esquema: semanaSchema, ip: await ipActual() });
  return r.ok ? { ...r, datos: r.datos.bloques } : r;
}

/** Bloqueos que terminan después de `desde` (instante ISO): los próximos y los vigentes. */
export async function listarBloqueosDesde(medicoId: string, desde: string): Promise<Resultado<Bloqueo[]>> {
  const q = new URLSearchParams({ desde });
  const r = await llamarGateway(`${medico(medicoId)}/bloqueos?${q}`, { auth: 'token', esquema: bloqueosSchema, ip: await ipActual() });
  return r.ok ? { ...r, datos: r.datos.bloqueos } : r;
}

export const guardarHorarioEnApi = async (medicoId: string, bloques: BloqueHorarioDto[]) =>
  llamarGateway(`${medico(medicoId)}/horario`, { metodo: 'PUT', cuerpo: { bloques }, auth: 'token', ip: await ipActual() });

export const crearTipoCitaEnApi = async (medicoId: string, cuerpo: unknown) =>
  llamarGateway(`${medico(medicoId)}/tipos-cita`, { metodo: 'POST', cuerpo, auth: 'token', ip: await ipActual() });

export const editarTipoCitaEnApi = async (medicoId: string, tipoId: string, cuerpo: unknown) =>
  llamarGateway(`${medico(medicoId)}/tipos-cita/${encodeURIComponent(tipoId)}`, { metodo: 'PATCH', cuerpo, auth: 'token', ip: await ipActual() });

export const crearBloqueoEnApi = async (medicoId: string, cuerpo: unknown) =>
  llamarGateway(`${medico(medicoId)}/bloqueos`, { metodo: 'POST', cuerpo, auth: 'token', ip: await ipActual() });

export const eliminarBloqueoEnApi = async (medicoId: string, bloqueoId: string) =>
  llamarGateway(`${medico(medicoId)}/bloqueos/${encodeURIComponent(bloqueoId)}`, { metodo: 'DELETE', auth: 'token', ip: await ipActual() });
