import { withTenant } from '@consultorio/platform';
import type pg from 'pg';
import type { Logger } from 'pino';
import { uuidv7 } from 'uuidv7';
import { armarCorreo } from './correo/mensaje.js';
import { leerConfig } from './datos/config.js';
import { registrarConsultorio } from './datos/consultorios.js';
import { asegurarEnvioCorreo, asignarToken, leerEnvio, marcarEnviado, registrarFallo } from './datos/envios.js';
import { debeEnviar, fechaCitaLocal, fechaYHoraLocal } from './dominio/calendario.js';
import { generarToken } from './dominio/token.js';
import type { Puertos } from './puertos.js';

/** Intentos de correo por envío antes de marcarlo `fallido`. */
export const MAX_INTENTOS = 3;

export interface ContextoEnvio {
  pool: pg.Pool;
  puertos: Puertos;
  reloj: () => Date;
  /** Origen público del sitio web (enlaces `/r/{token}`). */
  webOrigen: string;
  /** Solo se registran identificadores (envioId, citaId): nunca correos, teléfonos ni nombres. */
  logger?: Logger;
}

const tieneCorreo = (email: string | null): email is string => email !== null && email.trim().length > 0;

/**
 * Envía el correo de un envío si corresponde según el modo. Idempotente: un envío ya `enviado` (o anulado, fallido,
 * o sin aprobar en `con_revision`) da `omitido`. Cada intento que envía lleva un token nuevo; el correo sale fuera de transacción.
 * Un fallo de agenda o identidad se propaga (no cuenta como intento). `enviadoPor` es el usuario que lo disparó, o null si fue automático.
 */
export async function enviarCorreo(ctx: ContextoEnvio, tenantId: string, envioId: string, enviadoPor: string | null = null): Promise<'enviado' | 'fallido' | 'omitido'> {
  const previo = await withTenant(ctx.pool, tenantId, async (tx) => {
    const envio = await leerEnvio(tx, tenantId, envioId);
    if (!envio || envio.canal !== 'correo') return null;
    const config = await leerConfig(tx, tenantId);
    return debeEnviar(envio, config.modo) ? { envio, config } : null;
  });
  if (!previo) return 'omitido';
  const { envio, config } = previo;

  const citas = await ctx.puertos.agenda.obtenerCitas(tenantId, envio.fechaCita, envio.fechaCita);
  const cita = citas.find((c) => c.citaId === envio.citaId);
  if (!cita || !tieneCorreo(cita.contacto.email)) return 'omitido';
  const destino = cita.contacto.email.trim();
  const consultorio = await ctx.puertos.identidad.obtenerConsultorio(tenantId);
  const logo = consultorio.logoKey ? (await ctx.puertos.almacen.leer(consultorio.logoKey))?.bytes : undefined;

  // Transacción corta: el token nuevo reemplaza al anterior y se vuelve a comprobar que el envío siga vigente.
  const { token, hash } = generarToken();
  const reservado = await withTenant(ctx.pool, tenantId, async (tx) => {
    const actual = await leerEnvio(tx, tenantId, envioId, true);
    if (!actual || !debeEnviar(actual, config.modo)) return false;
    await asignarToken(tx, envioId, hash, cita.inicio);
    return true;
  });
  if (!reservado) return 'omitido';

  const { fecha, hora } = fechaYHoraLocal(cita.inicio, consultorio.zonaHoraria);
  const enlace = (accion: string) => `${ctx.webOrigen.replace(/\/+$/, '')}/r/${token}?accion=${accion}`;
  const correo = armarCorreo({
    plantillas: config.plantillas,
    datos: {
      paciente: cita.contacto.nombre,
      fecha,
      hora,
      medico: cita.medicoNombre,
      consultorio: consultorio.nombreMostrado,
      telefono_consultorio: consultorio.telefono ?? '',
    },
    consultorio,
    ...(logo ? { logo } : {}),
    enlaces: { confirmar: enlace('confirma'), cancelar: enlace('cancela'), cambiar: enlace('pide_cambio') },
  });

  try {
    await ctx.puertos.correo.enviar({ para: destino, asunto: correo.asunto, html: correo.html, texto: correo.texto, adjuntos: correo.adjuntos });
  } catch (err) {
    const { intentos, estado } = await withTenant(ctx.pool, tenantId, (tx) => registrarFallo(tx, envioId, MAX_INTENTOS));
    // El mensaje del error puede traer la dirección del paciente: solo se registra su código.
    ctx.logger?.warn({ envioId, citaId: envio.citaId, intentos, estado, codigo: (err as { code?: unknown }).code }, 'no se pudo enviar el correo');
    return 'fallido';
  }
  await withTenant(ctx.pool, tenantId, (tx) => marcarEnviado(tx, envioId, ctx.reloj(), enviadoPor));
  ctx.logger?.info({ envioId, citaId: envio.citaId }, 'correo enviado');
  return 'enviado';
}

/**
 * Crea las filas `pendiente` de correo de las citas entre `desde` y `hasta` (fechas locales `YYYY-MM-DD`) que tienen
 * correo, y registra el consultorio si falta. Idempotente.
 */
export async function asegurarEnvios(ctx: ContextoEnvio, tenantId: string, desde: string, hasta: string): Promise<void> {
  const [citas, consultorio] = await Promise.all([ctx.puertos.agenda.obtenerCitas(tenantId, desde, hasta), ctx.puertos.identidad.obtenerConsultorio(tenantId)]);
  await withTenant(ctx.pool, tenantId, async (tx) => {
    await registrarConsultorio(tx, tenantId, consultorio.zonaHoraria);
    for (const c of citas) {
      if (!tieneCorreo(c.contacto.email)) continue;
      await asegurarEnvioCorreo(tx, uuidv7(), tenantId, c.citaId, fechaCitaLocal(c.inicio, consultorio.zonaHoraria));
    }
  });
}
