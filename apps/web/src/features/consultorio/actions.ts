'use server';

import { revalidatePath } from 'next/cache';
import { estadoDeFallo, type Fallo } from '@/features/comun/errores';
import { textosDe } from '@/features/sesion/logica/validaciones';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { obtenerConsultorioEnApi, personalizarEnApi, quitarLogoEnApi, subirLogoEnApi } from './api';
import { cambiosDePersonalizacion, errorDeColor, errorDeLogo, MENSAJE_LOGO_TIPO } from './logica/formulario';

const CAMPOS = ['nombreComercial', 'direccion', 'telefono', 'colorPrimario'] as const;
const MENSAJE_LOGO_NO_GUARDADO = 'No se pudo guardar el logo ahora. Intenta de nuevo más tarde.';

/** La personalización cambia el encabezado y los colores de toda el área autenticada. */
const refrescarApp = () => revalidatePath('/', 'layout');

/** `details: [{ campo }]` de un 400 VALIDACION: el campo del formulario al que pertenece el mensaje. */
function campoDelError(r: Fallo): string | undefined {
  const d = r.error.details;
  const campo = Array.isArray(d) ? (d[0] as { campo?: unknown } | undefined)?.campo : undefined;
  return typeof campo === 'string' ? campo : undefined;
}

export async function guardarPersonalizacion(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const t = textosDe(fd);
  const valores = Object.fromEntries(CAMPOS.flatMap((c) => (t[c] === undefined ? [] : [[c, t[c] as string]])));
  const color = (t.colorPrimario ?? '').trim().toLowerCase();
  const errorColor = errorDeColor(color);
  if (errorColor) return { errores: { colorPrimario: errorColor }, valores };

  const actual = await obtenerConsultorioEnApi();
  if (!actual.ok) return estadoDeFallo(actual);
  const cambios = cambiosDePersonalizacion(actual.datos, valores);
  if (Object.keys(cambios).length === 0) return { ok: true };

  const r = await personalizarEnApi(cambios);
  if (!r.ok) {
    const campo = campoDelError(r);
    if (r.status === 400 && campo) return { errores: { [campo]: r.error.message }, valores };
    return { ...estadoDeFallo(r), valores };
  }
  refrescarApp();
  return { ok: true };
}

export async function subirLogo(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const archivo = fd.get('logo');
  // El navegador ya lo comprobó; aquí se repite porque la acción también se puede invocar sin la interfaz.
  if (!(archivo instanceof File)) return { errores: { logo: MENSAJE_LOGO_TIPO } };
  const error = errorDeLogo(archivo);
  if (error) return { errores: { logo: error } };

  const r = await subirLogoEnApi(new Uint8Array(await archivo.arrayBuffer()), archivo.type);
  if (!r.ok) {
    if (r.status === 400) return { errores: { logo: r.error.message } };
    if (r.status === 503) return { mensaje: MENSAJE_LOGO_NO_GUARDADO };
    return estadoDeFallo(r);
  }
  refrescarApp();
  return { ok: true };
}

export async function quitarLogo(): Promise<EstadoFormulario> {
  const r = await quitarLogoEnApi();
  if (!r.ok) return estadoDeFallo(r);
  refrescarApp();
  return { ok: true };
}
