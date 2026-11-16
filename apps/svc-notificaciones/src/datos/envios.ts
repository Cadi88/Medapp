import type pg from 'pg';
import type { EstadoEnvio } from '../dominio/calendario.js';

export interface Envio {
  id: string;
  citaId: string;
  fechaCita: string;
  canal: 'correo' | 'whatsapp_asistido';
  estado: EstadoEnvio;
  intentos: number;
}

interface Fila {
  id: string;
  cita_id: string;
  fecha_cita: string;
  canal: Envio['canal'];
  estado: EstadoEnvio;
  intentos: number;
}

/** Envío del tenant activo (la RLS de `tx` acota el tenant). */
export async function leerEnvio(tx: pg.PoolClient, tenantId: string, envioId: string): Promise<Envio | null> {
  const r = await tx.query<Fila>(
    `SELECT id, cita_id, fecha_cita::text AS fecha_cita, canal, estado, intentos FROM envio WHERE tenant_id = $1 AND id = $2`,
    [tenantId, envioId],
  );
  const f = r.rows[0];
  return f ? { id: f.id, citaId: f.cita_id, fechaCita: f.fecha_cita, canal: f.canal, estado: f.estado, intentos: f.intentos } : null;
}

/**
 * Crea el envío de correo `pendiente` de la cita en esa fecha. Si ya existe no lo toca, salvo uno `anulado`
 * (la cita volvió a esa fecha tras reprogramarse): vuelve a `pendiente` sin aprobación, respuesta ni intentos.
 */
export async function asegurarEnvioCorreo(tx: pg.PoolClient, id: string, tenantId: string, citaId: string, fechaCita: string): Promise<void> {
  await tx.query(
    `INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal) VALUES ($1, $2, $3, $4, 'correo')
     ON CONFLICT (tenant_id, cita_id, fecha_cita, canal) DO UPDATE
       SET estado = 'pendiente', intentos = 0, aprobado_por = NULL, aprobado_en = NULL, enviado_por = NULL, enviado_en = NULL,
           token_hash = NULL, token_expira_en = NULL, reclamado_en = NULL, respuesta = NULL, respondido_en = NULL, respondido_por = NULL
       WHERE envio.estado = 'anulado'`,
    [id, tenantId, citaId, fechaCita],
  );
}

/** Minutos tras los que un reclamo abandonado (proceso caído) puede volver a tomarse. */
export const VIGENCIA_RECLAMO_MIN = 5;

/**
 * Reclama el envío para enviarlo: guarda el token nuevo (un solo token vigente por envío) y marca el reclamo.
 * Solo quien obtiene la fila envía; un reclamo vigente de otro, o un estado no elegible, da `false`.
 */
export async function reclamarEnvio(tx: pg.PoolClient, tenantId: string, envioId: string, hash: string, expiraEn: string, estados: readonly EstadoEnvio[]): Promise<boolean> {
  const r = await tx.query(
    `UPDATE envio SET token_hash = $3, token_expira_en = $4, reclamado_en = now()
      WHERE tenant_id = $1 AND id = $2 AND estado = ANY($5::text[])
        AND (reclamado_en IS NULL OR reclamado_en < now() - make_interval(mins => $6))`,
    [tenantId, envioId, hash, expiraEn, estados, VIGENCIA_RECLAMO_MIN],
  );
  return r.rowCount === 1;
}

/** Marca enviado solo si el reclamo sigue siendo el nuestro (mismo token) y el envío no se anuló mientras tanto. */
export async function marcarEnviado(tx: pg.PoolClient, envioId: string, hash: string, enviadoEn: Date, enviadoPor: string | null): Promise<boolean> {
  const r = await tx.query(
    `UPDATE envio SET estado = 'enviado', enviado_en = $3, enviado_por = $4, reclamado_en = NULL
      WHERE id = $1 AND token_hash = $2 AND estado IN ('pendiente', 'aprobado')`,
    [envioId, hash, enviadoEn, enviadoPor],
  );
  return r.rowCount === 1;
}

/**
 * Suma un intento fallido, descarta el token (nunca llegó), libera el reclamo y marca `fallido` al llegar a `maxIntentos`.
 * `null` si el reclamo ya no era nuestro o el envío se anuló mientras tanto (no se pisa).
 */
export async function registrarFallo(tx: pg.PoolClient, envioId: string, hash: string, maxIntentos: number): Promise<{ intentos: number; estado: EstadoEnvio } | null> {
  const r = await tx.query<{ intentos: number; estado: EstadoEnvio }>(
    `UPDATE envio SET intentos = intentos + 1, token_hash = NULL, token_expira_en = NULL, reclamado_en = NULL,
                      estado = CASE WHEN intentos + 1 >= $3 THEN 'fallido' ELSE estado END
      WHERE id = $1 AND token_hash = $2 AND estado IN ('pendiente', 'aprobado') RETURNING intentos, estado`,
    [envioId, hash, maxIntentos],
  );
  return r.rows[0] ?? null;
}

/** La cita cambió de fecha: los envíos (de cualquier canal) de la fecha anterior dejan de valer y su token también. */
export async function anularPorReprogramacion(tx: pg.PoolClient, tenantId: string, citaId: string, fechaAnterior: string): Promise<void> {
  await tx.query(
    `UPDATE envio SET estado = 'anulado', token_hash = NULL, token_expira_en = NULL, reclamado_en = NULL
      WHERE tenant_id = $1 AND cita_id = $2 AND fecha_cita = $3 AND estado <> 'anulado'`,
    [tenantId, citaId, fechaAnterior],
  );
}

/** Cita cancelada: se anula lo que aún no se envió. */
export async function anularNoEnviados(tx: pg.PoolClient, tenantId: string, citaId: string): Promise<void> {
  await tx.query(
    `UPDATE envio SET estado = 'anulado', token_hash = NULL, token_expira_en = NULL, reclamado_en = NULL
      WHERE tenant_id = $1 AND cita_id = $2 AND estado IN ('pendiente', 'aprobado', 'fallido')`,
    [tenantId, citaId],
  );
}

/** Envíos de correo de las citas de esa fecha local (la RLS de `tx` acota el tenant). */
export async function listarEnviosCorreoDeFecha(tx: pg.PoolClient, tenantId: string, fechaCita: string): Promise<Envio[]> {
  const r = await tx.query<Fila>(
    `SELECT id, cita_id, fecha_cita::text AS fecha_cita, canal, estado, intentos FROM envio
      WHERE tenant_id = $1 AND fecha_cita = $2 AND canal = 'correo' ORDER BY creado_en, id`,
    [tenantId, fechaCita],
  );
  return r.rows.map((f) => ({ id: f.id, citaId: f.cita_id, fechaCita: f.fecha_cita, canal: f.canal, estado: f.estado, intentos: f.intentos }));
}

export type Respuesta = 'confirma' | 'cancela' | 'pide_cambio';

/** Envío con su respuesta, para la pantalla de recordatorios. */
export interface EnvioDetalle extends Envio {
  respuesta: Respuesta | null;
  respondidoEn: Date | null;
  /** `paciente` o el id del usuario de recepción. */
  respondidoPor: string | null;
}

interface FilaDetalle extends Fila {
  respuesta: Respuesta | null;
  respondido_en: Date | null;
  respondido_por: string | null;
}

const aEnvio = (f: Fila): Envio => ({ id: f.id, citaId: f.cita_id, fechaCita: f.fecha_cita, canal: f.canal, estado: f.estado, intentos: f.intentos });

/** Envíos (de cualquier canal) de las citas entre dos fechas locales, ambas inclusive. */
export async function listarEnviosDeRango(tx: pg.PoolClient, tenantId: string, desde: string, hasta: string): Promise<EnvioDetalle[]> {
  const r = await tx.query<FilaDetalle>(
    `SELECT id, cita_id, fecha_cita::text AS fecha_cita, canal, estado, intentos, respuesta, respondido_en, respondido_por
       FROM envio WHERE tenant_id = $1 AND fecha_cita BETWEEN $2 AND $3 ORDER BY creado_en, id`,
    [tenantId, desde, hasta],
  );
  return r.rows.map((f) => ({ ...aEnvio(f), respuesta: f.respuesta, respondidoEn: f.respondido_en, respondidoPor: f.respondido_por }));
}

/** Envío de correo vigente (no anulado) de la cita; si hubo varias fechas, el de la más reciente. */
export async function envioCorreoVigenteDeCita(tx: pg.PoolClient, tenantId: string, citaId: string): Promise<Envio | null> {
  const r = await tx.query<Fila>(
    `SELECT id, cita_id, fecha_cita::text AS fecha_cita, canal, estado, intentos FROM envio
      WHERE tenant_id = $1 AND cita_id = $2 AND canal = 'correo' AND estado <> 'anulado' ORDER BY fecha_cita DESC LIMIT 1`,
    [tenantId, citaId],
  );
  return r.rows[0] ? aEnvio(r.rows[0]) : null;
}

/** `pendiente` → `aprobado`. `false` si el envío no estaba pendiente (ya aprobado, enviado, fallido o anulado). */
export async function aprobarEnvio(tx: pg.PoolClient, tenantId: string, envioId: string, usuarioId: string, ahora: Date): Promise<boolean> {
  const r = await tx.query(
    `UPDATE envio SET estado = 'aprobado', aprobado_por = $3, aprobado_en = $4 WHERE tenant_id = $1 AND id = $2 AND canal = 'correo' AND estado = 'pendiente'`,
    [tenantId, envioId, usuarioId, ahora],
  );
  return r.rowCount === 1;
}

/** Aprueba todos los correos `pendiente` de las citas entre dos fechas locales; devuelve los recién aprobados. */
export async function aprobarPendientes(tx: pg.PoolClient, tenantId: string, desde: string, hasta: string, usuarioId: string, ahora: Date): Promise<Envio[]> {
  const r = await tx.query<Fila>(
    `UPDATE envio SET estado = 'aprobado', aprobado_por = $4, aprobado_en = $5
      WHERE tenant_id = $1 AND canal = 'correo' AND estado = 'pendiente' AND fecha_cita BETWEEN $2 AND $3
      RETURNING id, cita_id, fecha_cita::text AS fecha_cita, canal, estado, intentos`,
    [tenantId, desde, hasta, usuarioId, ahora],
  );
  return r.rows.map(aEnvio);
}

/** Reintento manual de un correo `fallido`: vuelve a `aprobado` con los intentos en cero. `false` si no estaba fallido. */
export async function reabrirFallido(tx: pg.PoolClient, tenantId: string, envioId: string, usuarioId: string, ahora: Date): Promise<boolean> {
  const r = await tx.query(
    `UPDATE envio SET estado = 'aprobado', intentos = 0, aprobado_por = $3, aprobado_en = $4, reclamado_en = NULL
      WHERE tenant_id = $1 AND id = $2 AND canal = 'correo' AND estado = 'fallido'`,
    [tenantId, envioId, usuarioId, ahora],
  );
  return r.rowCount === 1;
}

/**
 * Registra "WhatsApp abierto por {usuario}" (estado `enviado`). Si ya existía queda como la última apertura; uno `anulado`
 * (la cita volvió a esa fecha) arranca de cero, sin respuesta.
 */
export async function registrarWhatsAppAbierto(tx: pg.PoolClient, id: string, tenantId: string, citaId: string, fechaCita: string, usuarioId: string, ahora: Date): Promise<void> {
  await tx.query(
    `INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, estado, enviado_por, enviado_en) VALUES ($1, $2, $3, $4, 'whatsapp_asistido', 'enviado', $5, $6)
     ON CONFLICT (tenant_id, cita_id, fecha_cita, canal) DO UPDATE
       SET respuesta = CASE WHEN envio.estado = 'anulado' THEN NULL ELSE envio.respuesta END,
           respondido_en = CASE WHEN envio.estado = 'anulado' THEN NULL ELSE envio.respondido_en END,
           respondido_por = CASE WHEN envio.estado = 'anulado' THEN NULL ELSE envio.respondido_por END,
           estado = 'enviado', enviado_por = $5, enviado_en = $6`,
    [id, tenantId, citaId, fechaCita, usuarioId, ahora],
  );
}

/** Respuesta que recepción recibió por WhatsApp: crea el envío de WhatsApp si no existía (estado `enviado`) y guarda la respuesta. */
export async function registrarRespuestaDeRecepcion(
  tx: pg.PoolClient,
  id: string,
  tenantId: string,
  citaId: string,
  fechaCita: string,
  usuarioId: string,
  respuesta: Respuesta,
  ahora: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, estado, enviado_por, enviado_en, respuesta, respondido_en, respondido_por)
     VALUES ($1, $2, $3, $4, 'whatsapp_asistido', 'enviado', $5::uuid, $6, $7, $6, $5::text)
     ON CONFLICT (tenant_id, cita_id, fecha_cita, canal) DO UPDATE
       SET estado = 'enviado', respuesta = $7, respondido_en = $6, respondido_por = $5::text`,
    [id, tenantId, citaId, fechaCita, usuarioId, ahora, respuesta],
  );
}
