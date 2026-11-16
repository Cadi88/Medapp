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
