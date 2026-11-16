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

/** Envío del tenant activo (la RLS de `tx` acota el tenant); `bloquear` serializa lecturas concurrentes de la misma fila. */
export async function leerEnvio(tx: pg.PoolClient, tenantId: string, envioId: string, bloquear = false): Promise<Envio | null> {
  const r = await tx.query<Fila>(
    `SELECT id, cita_id, fecha_cita::text AS fecha_cita, canal, estado, intentos FROM envio WHERE tenant_id = $1 AND id = $2${bloquear ? ' FOR UPDATE' : ''}`,
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
           token_hash = NULL, token_expira_en = NULL, respuesta = NULL, respondido_en = NULL, respondido_por = NULL
       WHERE envio.estado = 'anulado'`,
    [id, tenantId, citaId, fechaCita],
  );
}

/** Un solo token vigente por envío: reemplaza el anterior. */
export async function asignarToken(tx: pg.PoolClient, envioId: string, hash: string, expiraEn: string): Promise<void> {
  await tx.query('UPDATE envio SET token_hash = $2, token_expira_en = $3 WHERE id = $1', [envioId, hash, expiraEn]);
}

export async function marcarEnviado(tx: pg.PoolClient, envioId: string, enviadoEn: Date, enviadoPor: string | null): Promise<void> {
  await tx.query("UPDATE envio SET estado = 'enviado', enviado_en = $2, enviado_por = $3 WHERE id = $1", [envioId, enviadoEn, enviadoPor]);
}

/** Suma un intento fallido, descarta el token (nunca llegó) y marca `fallido` al llegar a `maxIntentos`. */
export async function registrarFallo(tx: pg.PoolClient, envioId: string, maxIntentos: number): Promise<{ intentos: number; estado: EstadoEnvio }> {
  const r = await tx.query<{ intentos: number; estado: EstadoEnvio }>(
    `UPDATE envio SET intentos = intentos + 1, token_hash = NULL, token_expira_en = NULL,
                      estado = CASE WHEN intentos + 1 >= $2 THEN 'fallido' ELSE estado END
      WHERE id = $1 RETURNING intentos, estado`,
    [envioId, maxIntentos],
  );
  return r.rows[0]!;
}

/** La cita cambió de fecha: los envíos (de cualquier canal) de la fecha anterior dejan de valer y su token también. */
export async function anularPorReprogramacion(tx: pg.PoolClient, tenantId: string, citaId: string, fechaAnterior: string): Promise<void> {
  await tx.query(
    `UPDATE envio SET estado = 'anulado', token_hash = NULL, token_expira_en = NULL
      WHERE tenant_id = $1 AND cita_id = $2 AND fecha_cita = $3 AND estado <> 'anulado'`,
    [tenantId, citaId, fechaAnterior],
  );
}

/** Cita cancelada: se anula lo que aún no se envió. */
export async function anularNoEnviados(tx: pg.PoolClient, tenantId: string, citaId: string): Promise<void> {
  await tx.query(
    `UPDATE envio SET estado = 'anulado', token_hash = NULL, token_expira_en = NULL
      WHERE tenant_id = $1 AND cita_id = $2 AND estado IN ('pendiente', 'aprobado', 'fallido')`,
    [tenantId, citaId],
  );
}
