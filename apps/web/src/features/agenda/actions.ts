'use server';

import { cambiarEstadoSchema, reprogramarCitaSchema } from '@consultorio/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Resultado } from '@/lib/api/resultado';
import { destinoPorError } from '@/lib/sesion/desvios';
import { erroresDeZod } from '@/features/sesion/logica/validaciones';
import { cambiarEstadoEnApi, crearCitaEnApi, listarCitas, obtenerDisponibilidad, reprogramarCitaEnApi } from './api';
import { mensajeDeError, pideRecargar, type ContextoError } from './logica/errores';
import { altaCitaSchema, consultaCitasSchema, consultaHuecosSchema, idCitaSchema, type AltaCita } from './logica/validaciones';
import type { LecturaCitas, LecturaHuecos, ResultadoAccion } from './tipos';

type Fallo = Extract<Resultado<unknown>, { ok: false }>;

const DATOS_INVALIDOS = mensajeDeError('VALIDACION');

/** Sesión vencida, contraseña temporal, sin permiso… van a su pantalla; el resto se traduce a texto para la interfaz. */
function desviarOMensaje(r: Fallo, contexto?: ContextoError): string {
  const destino = destinoPorError(r.error, r.status);
  if (destino) redirect(destino);
  return mensajeDeError(r.error.code, contexto);
}

function aResultado(r: Fallo): ResultadoAccion {
  if (r.error.code === 'FUERA_DE_HORARIO') return { ok: false, motivo: 'FUERA_DE_HORARIO' };
  const mensaje = desviarOMensaje(r);
  return pideRecargar(r.error.code) ? { mensaje, recargar: true } : { mensaje };
}

function exitoso(): ResultadoAccion {
  revalidatePath('/agenda');
  return { ok: true };
}

export async function crearCita(entrada: AltaCita): Promise<ResultadoAccion> {
  const v = altaCitaSchema.safeParse(entrada);
  if (!v.success) return { errores: erroresDeZod(v.error) };
  const d = v.data;
  const cuerpo = {
    medicoId: d.medicoId,
    tipoCitaId: d.tipoCitaId,
    inicio: d.inicio,
    contacto: { nombre: d.nombre, telefono: d.telefono, ...(d.email ? { email: d.email } : {}) },
    ...(d.notas ? { notas: d.notas } : {}),
    fueraDeHorario: d.fueraDeHorario,
  };
  const r = await crearCitaEnApi(cuerpo);
  return r.ok ? exitoso() : aResultado(r);
}

export async function reprogramarCita(entrada: {
  citaId: string;
  version: number;
  inicio: string;
  tipoCitaId?: string;
  medicoId?: string;
  fueraDeHorario?: boolean;
}): Promise<ResultadoAccion> {
  const { citaId, ...resto } = entrada;
  const id = idCitaSchema.safeParse(citaId);
  const cuerpo = reprogramarCitaSchema.safeParse(resto);
  if (!id.success || !cuerpo.success) return { mensaje: DATOS_INVALIDOS };
  const r = await reprogramarCitaEnApi(id.data, cuerpo.data);
  return r.ok ? exitoso() : aResultado(r);
}

export async function cambiarEstadoCita(entrada: { citaId: string; version: number; estado: string }): Promise<ResultadoAccion> {
  const id = idCitaSchema.safeParse(entrada.citaId);
  const cuerpo = cambiarEstadoSchema.safeParse({ version: entrada.version, estado: entrada.estado });
  if (!id.success || !cuerpo.success) return { mensaje: DATOS_INVALIDOS };
  const r = await cambiarEstadoEnApi(id.data, cuerpo.data);
  return r.ok ? exitoso() : aResultado(r);
}

/** Lectura para el calendario del navegador (el token vive solo en el servidor). */
export async function cargarCitas(desde: string, hasta: string, medicoId?: string): Promise<LecturaCitas> {
  const v = consultaCitasSchema.safeParse({ desde, hasta, ...(medicoId ? { medicoId } : {}) });
  if (!v.success) return { ok: false, mensaje: DATOS_INVALIDOS };
  const r = await listarCitas(v.data.desde, v.data.hasta, v.data.medicoId);
  return r.ok ? { ok: true, citas: r.datos } : { ok: false, mensaje: desviarOMensaje(r) };
}

/** Huecos libres del médico ese día para el tipo de cita elegido. */
export async function cargarHuecos(medicoId: string, fecha: string, tipoCitaId: string): Promise<LecturaHuecos> {
  const v = consultaHuecosSchema.safeParse({ medicoId, fecha, tipoCitaId });
  if (!v.success) return { ok: false, mensaje: DATOS_INVALIDOS };
  const r = await obtenerDisponibilidad(v.data.medicoId, v.data.fecha, v.data.tipoCitaId);
  return r.ok ? { ok: true, huecos: r.datos } : { ok: false, mensaje: desviarOMensaje(r, 'disponibilidad') };
}
