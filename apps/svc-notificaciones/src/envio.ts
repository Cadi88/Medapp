import { withTenant } from '@consultorio/platform';
import type pg from 'pg';
import type { Logger } from 'pino';
import { uuidv7 } from 'uuidv7';
import { armarCorreo } from './correo/mensaje.js';
import { leerConfig } from './datos/config.js';
import { registrarConsultorio } from './datos/consultorios.js';
import { asegurarEnvioCorreo, leerEnvio, marcarEnviado, reclamarEnvio, registrarFallo } from './datos/envios.js';
import { debeEnviar, estadosEnviables, fechaCitaLocal, fechaYHoraLocal } from './dominio/calendario.js';
import type { EstadoEnvio } from './dominio/calendario.js';
import { hayCorreo } from './dominio/recordatorios.js';
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

/**
 * `fallido` con `estado` aún reintentable (`pendiente`/`aprobado`) es un fallo transitorio; con `fallido` es definitivo.
 * `ocupado`: otro proceso tiene un reclamo vigente sobre el envío; no se intentó y conviene reintentarlo más tarde.
 */
export interface ResultadoEnvio {
  resultado: 'enviado' | 'fallido' | 'omitido' | 'ocupado';
  /** Estado del envío tras la llamada (`null` si no existe). */
  estado: EstadoEnvio | null;
  intentos: number;
}

/**
 * Envía el correo de un envío si corresponde según el modo. Idempotente: un envío ya `enviado` (o anulado, fallido,
 * o sin aprobar en `con_revision`) da `omitido`. Cada intento que envía lleva un token nuevo; el correo sale fuera de transacción.
 * Un fallo de agenda o identidad se propaga (no cuenta como intento). `enviadoPor` es el usuario que lo disparó, o null si fue automático.
 */
export async function enviarCorreo(ctx: ContextoEnvio, tenantId: string, envioId: string, enviadoPor: string | null = null): Promise<ResultadoEnvio> {
  const previo = await withTenant(ctx.pool, tenantId, async (tx) => {
    const envio = await leerEnvio(tx, tenantId, envioId);
    return envio ? { envio, config: await leerConfig(tx, tenantId) } : null;
  });
  if (!previo) return { resultado: 'omitido', estado: null, intentos: 0 };
  const { envio, config } = previo;
  const omitido = (): ResultadoEnvio => ({ resultado: 'omitido', estado: envio.estado, intentos: envio.intentos });
  if (envio.canal !== 'correo' || !debeEnviar(envio, config.modo)) return omitido();

  const citas = await ctx.puertos.agenda.obtenerCitas(tenantId, envio.fechaCita, envio.fechaCita);
  const cita = citas.find((c) => c.citaId === envio.citaId);
  if (!cita || !hayCorreo(cita.contacto.email)) return omitido();
  const destino = cita.contacto.email.trim();
  const consultorio = await ctx.puertos.identidad.obtenerConsultorio(tenantId);
  let logo: Uint8Array | undefined;
  if (consultorio.logoKey) {
    try {
      logo = (await ctx.puertos.almacen.leer(consultorio.logoKey))?.bytes;
    } catch {
      // Un almacén caído no debe impedir el recordatorio: sale sin logo.
      ctx.logger?.warn({ envioId, citaId: envio.citaId }, 'no se pudo leer el logo; el correo sale sin logo');
    }
  }

  // Reclamo atómico: el token nuevo reemplaza al anterior y solo quien reclama el envío lo envía (nunca dos correos).
  const { token, hash } = generarToken();
  const reclamado = await withTenant(ctx.pool, tenantId, (tx) => reclamarEnvio(tx, tenantId, envioId, hash, cita.inicio, estadosEnviables(config.modo)));
  if (!reclamado) {
    // Sigue enviable pero el reclamo no fue nuestro: otro proceso lo está enviando (si cambió de estado, simplemente se omite).
    const actual = await withTenant(ctx.pool, tenantId, (tx) => leerEnvio(tx, tenantId, envioId));
    return actual && debeEnviar(actual, config.modo) ? { resultado: 'ocupado', estado: actual.estado, intentos: actual.intentos } : omitido();
  }

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
    const fallo = await withTenant(ctx.pool, tenantId, (tx) => registrarFallo(tx, envioId, hash, MAX_INTENTOS));
    // El mensaje del error puede traer la dirección del paciente: solo se registra su código.
    ctx.logger?.warn({ envioId, citaId: envio.citaId, intentos: fallo?.intentos, estado: fallo?.estado, codigo: (err as { code?: unknown }).code }, 'no se pudo enviar el correo');
    return fallo ? { resultado: 'fallido', ...fallo } : { resultado: 'fallido', estado: 'anulado', intentos: envio.intentos };
  }
  const marcado = await withTenant(ctx.pool, tenantId, (tx) => marcarEnviado(tx, envioId, hash, ctx.reloj(), enviadoPor));
  ctx.logger?.info({ envioId, citaId: envio.citaId, anuladoDuranteEnvio: !marcado || undefined }, 'correo enviado');
  // Si se anuló mientras salía, el correo ya salió pero el envío queda anulado (no se pisa).
  return { resultado: 'enviado', estado: marcado ? 'enviado' : 'anulado', intentos: envio.intentos };
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
      if (!hayCorreo(c.contacto.email)) continue;
      await asegurarEnvioCorreo(tx, uuidv7(), tenantId, c.citaId, fechaCitaLocal(c.inicio, consultorio.zonaHoraria));
    }
  });
}
