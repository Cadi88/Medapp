'use server';

import { respuestaPacienteSchema } from '@consultorio/contracts';
import { registrarRespuestaEnApi } from './api';
import { tieneFormaDeToken } from './logica/enlace';
import type { EstadoRespuesta } from './tipos';

/** El token nunca se escribe en logs: ni se registra ni va en los mensajes. */
export async function enviarRespuesta(_prev: EstadoRespuesta, fd: FormData): Promise<EstadoRespuesta> {
  const token = fd.get('token');
  if (typeof token !== 'string' || !tieneFormaDeToken(token)) return { estado: 'invalida' };
  const respuesta = respuestaPacienteSchema.safeParse(fd.get('respuesta'));
  if (!respuesta.success) return { mensaje: 'Elige una opción para responder.' };

  const r = await registrarRespuestaEnApi(token, { respuesta: respuesta.data });
  if (r.ok) return { estado: r.datos.estado };
  if (r.status === 429) return { mensaje: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' };
  return { mensaje: 'No pudimos registrar tu respuesta. Intenta de nuevo.' };
}
