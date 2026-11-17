'use server';

import { abrirWhatsAppSchema, aprobarRangoSchema, citaIdParamsSchema, registrarRespuestaRecepcionSchema, type ResultadoEnvioApi } from '@consultorio/contracts';
import { revalidatePath } from 'next/cache';
import { estadoDeFallo, type Fallo } from '@/features/comun/errores';
import type { Resultado } from '@/lib/api/resultado';
import { abrirWhatsAppEnApi, aprobarEnApi, aprobarRangoEnApi, reintentarEnApi, registrarRespuestaEnApi } from './api';
import { TEXTO_NO_SE_PUDO_ENVIAR } from './logica/presentacion';
import type { ResultadoRecordatorio, ResultadoWhatsApp } from './tipos';

const DATOS_INVALIDOS = 'Revisa los datos del formulario';
const GENERICO = 'Ocurrió un error. Intenta de nuevo.';
const invalido = { mensaje: DATOS_INVALIDOS };

/** Errores que el servicio redactó para la persona (p. ej. "La cita ya empezó; no se puede reenviar el recordatorio"). */
const CODIGOS_CON_MENSAJE_PROPIO = new Set(['VALIDACION', 'NO_ENCONTRADO', 'CONFLICTO']);

/** Sesión vencida o sin permiso desvían; el resto: el mensaje del servicio si es de los suyos, si no el aviso genérico. */
function mensajeDeFallo(r: Fallo): string {
  const { mensaje } = estadoDeFallo(r);
  return CODIGOS_CON_MENSAJE_PROPIO.has(r.error.code) && r.error.message ? r.error.message : (mensaje ?? GENERICO);
}

/** Tras cualquier intento (también si falló) la pantalla se vuelve a leer: el estado pudo cambiar. */
const refrescar = () => revalidatePath('/recordatorios');

async function terminar(r: Resultado<unknown>): Promise<ResultadoRecordatorio> {
  refrescar();
  return r.ok ? { ok: true } : { mensaje: mensajeDeFallo(r) };
}

/** Termina una acción que pudo intentar un envío: si ese envío falló, se avisa (aunque la aprobación o el reintento haya quedado). */
async function terminarEnvio(r: Resultado<{ envio: ResultadoEnvioApi }>): Promise<ResultadoRecordatorio> {
  if (r.ok && r.datos.envio === 'fallido') {
    refrescar();
    return { mensaje: TEXTO_NO_SE_PUDO_ENVIAR };
  }
  return terminar(r);
}

/** Aprueba (o, con el correo ya aprobado y listo para salir, "Enviar ahora"); avisa si el envío de esa llamada falló. */
export async function aprobarRecordatorio(citaId: string): Promise<ResultadoRecordatorio> {
  const id = citaIdParamsSchema.safeParse({ citaId });
  return id.success ? terminarEnvio(await aprobarEnApi(id.data.citaId)) : invalido;
}

/** Aprueba (y envía lo que ya toca) todos los pendientes del rango que la pantalla está mostrando. */
export async function aprobarTodos(desde: string, hasta: string): Promise<ResultadoRecordatorio> {
  const rango = aprobarRangoSchema.safeParse({ desde, hasta });
  if (!rango.success) return invalido;
  const r = await aprobarRangoEnApi(rango.data);
  if (r.ok && r.datos.fallidos > 0) {
    refrescar();
    return { mensaje: r.datos.fallidos === 1 ? TEXTO_NO_SE_PUDO_ENVIAR : `${TEXTO_NO_SE_PUDO_ENVIAR} ${r.datos.fallidos} correos` };
  }
  return terminar(r);
}

export async function reintentarEnvio(citaId: string): Promise<ResultadoRecordatorio> {
  const id = citaIdParamsSchema.safeParse({ citaId });
  return id.success ? terminarEnvio(await reintentarEnApi(id.data.citaId)) : invalido;
}

/** Es un `https://wa.me/...`: lo único que el servicio debe devolver y lo único que el navegador abre. */
function esEnlaceDeWhatsApp(enlace: string): boolean {
  try {
    const url = new URL(enlace);
    return url.protocol === 'https:' && url.hostname === 'wa.me';
  } catch {
    return false;
  }
}

/** Registra "WhatsApp abierto" y entrega el enlace; el navegador lo abre solo si esto salió bien. */
export async function abrirWhatsApp(citaId: string, fecha: string): Promise<ResultadoWhatsApp> {
  const id = citaIdParamsSchema.safeParse({ citaId });
  const cuerpo = abrirWhatsAppSchema.safeParse({ fecha });
  if (!id.success || !cuerpo.success) return invalido;
  const r = await abrirWhatsAppEnApi(id.data.citaId, cuerpo.data);
  refrescar();
  if (!r.ok) return { mensaje: mensajeDeFallo(r) };
  return esEnlaceDeWhatsApp(r.datos.enlace) ? { ok: true, enlace: r.datos.enlace } : { mensaje: GENERICO };
}

/** Recepción registra lo que el paciente contestó por WhatsApp. */
export async function registrarRespuestaRecepcion(citaId: string, fecha: string, respuesta: string): Promise<ResultadoRecordatorio> {
  const id = citaIdParamsSchema.safeParse({ citaId });
  const cuerpo = registrarRespuestaRecepcionSchema.safeParse({ fecha, respuesta });
  return id.success && cuerpo.success ? terminar(await registrarRespuestaEnApi(id.data.citaId, cuerpo.data)) : invalido;
}
