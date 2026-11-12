'use server';

import { revalidatePath } from 'next/cache';
import { estadoDeFallo } from '@/features/comun/errores';
import { erroresDeZod, textosDe } from '@/features/sesion/logica/validaciones';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { obtenerContexto } from '@/lib/sesion/contexto';
import {
  crearBloqueoEnApi,
  crearTipoCitaEnApi,
  editarTipoCitaEnApi,
  eliminarBloqueoEnApi,
  guardarHorarioEnApi,
} from './api';
import { instanteDesdeLocal } from './logica/bloqueos';
import { semanaDesdeFormulario, validarSemana } from './logica/semana';
import { altaBloqueoSchema, DATOS_INVALIDOS, idsBloqueoSchema, idsTipoSchema, medicoIdSchema, tipoCitaFormSchema } from './logica/validaciones';

const ficha = (medicoId: string) => `/medicos/${medicoId}`;

export async function guardarSemana(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const medicoId = medicoIdSchema.safeParse(fd.get('medicoId'));
  if (!medicoId.success) return { mensaje: DATOS_INVALIDOS };
  const bloques = semanaDesdeFormulario(fd);
  const v = validarSemana(bloques);
  if (!v.ok) return { mensaje: v.error };
  const r = await guardarHorarioEnApi(medicoId.data, bloques);
  // 400: texto fijo; el detalle del servicio no se muestra.
  if (!r.ok) return estadoDeFallo(r, { VALIDACION: 'Revisa el horario: hay bloques inválidos o encimados' });
  revalidatePath(ficha(medicoId.data));
  return { ok: true };
}

export async function crearTipoCita(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const t = textosDe(fd);
  const medicoId = medicoIdSchema.safeParse(t.medicoId);
  if (!medicoId.success) return { mensaje: DATOS_INVALIDOS };
  const v = tipoCitaFormSchema.safeParse(t);
  if (!v.success) return { errores: erroresDeZod(v.error), valores: { nombre: t.nombre ?? '', duracionMin: t.duracionMin ?? '' } };
  const r = await crearTipoCitaEnApi(medicoId.data, v.data);
  if (!r.ok) return estadoDeFallo(r);
  revalidatePath(ficha(medicoId.data));
  return { ok: true };
}

export async function editarTipoCita(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const t = textosDe(fd);
  const ids = idsTipoSchema.safeParse(t);
  if (!ids.success) return { mensaje: DATOS_INVALIDOS };
  const v = tipoCitaFormSchema.safeParse(t);
  if (!v.success) return { errores: erroresDeZod(v.error) };
  const r = await editarTipoCitaEnApi(ids.data.medicoId, ids.data.tipoId, { ...v.data, activo: t.activo === 'on' });
  if (!r.ok) return estadoDeFallo(r);
  revalidatePath(ficha(ids.data.medicoId));
  return { ok: true };
}

export async function crearBloqueo(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const t = textosDe(fd);
  const medicoId = medicoIdSchema.safeParse(t.medicoId);
  if (!medicoId.success) return { mensaje: DATOS_INVALIDOS };
  const valores = { inicio: t.inicio ?? '', fin: t.fin ?? '', motivo: t.motivo ?? '' };
  const v = altaBloqueoSchema.safeParse(t);
  if (!v.success) return { errores: erroresDeZod(v.error), valores };
  // Las fechas son la hora de pared del consultorio: el desfase se resuelve con su zona, no con la del navegador.
  const { consultorio } = await obtenerContexto();
  const inicio = instanteDesdeLocal(v.data.inicio, consultorio.zonaHoraria);
  const fin = instanteDesdeLocal(v.data.fin, consultorio.zonaHoraria);
  if (!inicio || !fin) {
    return { errores: { [inicio ? 'fin' : 'inicio']: 'Elige una fecha y hora válidas' }, valores };
  }
  const r = await crearBloqueoEnApi(medicoId.data, { inicio, fin, ...(v.data.motivo ? { motivo: v.data.motivo } : {}) });
  if (!r.ok) return { ...estadoDeFallo(r), valores };
  revalidatePath(ficha(medicoId.data));
  return { ok: true };
}

export async function eliminarBloqueo(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const ids = idsBloqueoSchema.safeParse(textosDe(fd));
  if (!ids.success) return { mensaje: DATOS_INVALIDOS };
  const r = await eliminarBloqueoEnApi(ids.data.medicoId, ids.data.bloqueoId);
  if (!r.ok) return estadoDeFallo(r);
  revalidatePath(ficha(ids.data.medicoId));
  return { ok: true };
}
