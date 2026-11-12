'use server';

import { revalidatePath } from 'next/cache';
import { estadoDeFallo } from '@/features/comun/errores';
import { erroresDeZod, textosDe } from '@/features/sesion/logica/validaciones';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { obtenerContexto } from '@/lib/sesion/contexto';
import { guardarPerfilMedicoEnApi } from './api';
import { perfilMedicoSchema } from './logica/validaciones';

/** Perfil profesional de quien tiene la sesión: el médico sale del token, nunca del formulario. */
export async function guardarPerfilMedico(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const t = textosDe(fd);
  const valores = {
    cedulaProfesional: t.cedulaProfesional ?? '',
    especialidad: t.especialidad ?? '',
    cedulaEspecialidad: t.cedulaEspecialidad ?? '',
    institucion: t.institucion ?? '',
  };
  const v = perfilMedicoSchema.safeParse(t);
  if (!v.success) return { errores: erroresDeZod(v.error), valores };
  const { claims } = await obtenerContexto();
  const cuerpo = {
    cedulaProfesional: v.data.cedulaProfesional,
    ...(v.data.especialidad ? { especialidad: v.data.especialidad } : {}),
    ...(v.data.cedulaEspecialidad ? { cedulaEspecialidad: v.data.cedulaEspecialidad } : {}),
    ...(v.data.institucion ? { institucion: v.data.institucion } : {}),
  };
  const r = await guardarPerfilMedicoEnApi(claims.sub, cuerpo);
  if (!r.ok) return { ...estadoDeFallo(r), valores };
  revalidatePath('/perfil');
  return { ok: true };
}
