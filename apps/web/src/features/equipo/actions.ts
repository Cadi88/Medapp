'use server';

import { revalidatePath } from 'next/cache';
import { estadoDeFallo } from '@/features/comun/errores';
import { erroresDeZod, textosDe } from '@/features/sesion/logica/validaciones';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { altaMiembroEnApi, editarMiembroEnApi, quitarMiembroEnApi, reiniciarPasswordEnApi } from './api';
import {
  altaMiembroSchema,
  editarMiembroFormSchema,
  MENSAJE_ULTIMO_ADMIN,
  quitarMiembroSchema,
  reiniciarPasswordSchema,
} from './logica/validaciones';
import type { EstadoPasswordTemporal } from './tipos';

const RUTA = '/equipo';
const ULTIMO_ADMIN = { CONFLICTO: MENSAJE_ULTIMO_ADMIN };

export async function altaMiembro(_prev: EstadoPasswordTemporal, fd: FormData): Promise<EstadoPasswordTemporal> {
  const t = textosDe(fd);
  const valores = { nombre: t.nombre ?? '', email: t.email ?? '', rol: t.rol ?? '', admin: t.admin === 'on' ? 'on' : '' };
  const v = altaMiembroSchema.safeParse({ ...t, admin: t.admin === 'on' });
  if (!v.success) return { errores: erroresDeZod(v.error), valores };
  const r = await altaMiembroEnApi(v.data);
  if (!r.ok) return { ...estadoDeFallo(r, { CONFLICTO: 'Ese correo ya pertenece a otra persona del consultorio' }), valores };
  revalidatePath(RUTA);
  return { ok: true, passwordTemporal: v.data.passwordTemporal };
}

export async function editarMiembro(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const t = textosDe(fd);
  const v = editarMiembroFormSchema.safeParse({ ...t, admin: t.admin === 'on' });
  if (!v.success) return { errores: erroresDeZod(v.error) };
  const { usuarioId, ...cambios } = v.data;
  const r = await editarMiembroEnApi(usuarioId, cambios);
  if (!r.ok) return estadoDeFallo(r, ULTIMO_ADMIN);
  revalidatePath(RUTA);
  return { ok: true };
}

export async function reiniciarPassword(_prev: EstadoPasswordTemporal, fd: FormData): Promise<EstadoPasswordTemporal> {
  const v = reiniciarPasswordSchema.safeParse(textosDe(fd));
  if (!v.success) return { errores: erroresDeZod(v.error) };
  const { usuarioId, passwordTemporal } = v.data;
  const r = await reiniciarPasswordEnApi(usuarioId, { passwordTemporal });
  if (!r.ok) {
    return estadoDeFallo(r, { CONFLICTO: 'La cuenta también pertenece a otro consultorio: su contraseña no se puede reiniciar desde aquí' });
  }
  revalidatePath(RUTA);
  return { ok: true, passwordTemporal };
}

export async function quitarMiembro(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const v = quitarMiembroSchema.safeParse(textosDe(fd));
  if (!v.success) return { errores: erroresDeZod(v.error) };
  const r = await quitarMiembroEnApi(v.data.usuarioId);
  if (!r.ok) return estadoDeFallo(r, ULTIMO_ADMIN);
  revalidatePath(RUTA);
  return { ok: true };
}
