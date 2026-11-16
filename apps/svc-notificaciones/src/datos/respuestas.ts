import type pg from 'pg';
import type { EstadoEnvio } from '../dominio/calendario.js';
import type { Respuesta } from './envios.js';

/**
 * Busca el envío por el hash de su token SIN consultorio conocido (función SECURITY DEFINER `fn_envio_por_token`: solo
 * devuelve ids). Después hay que entrar a `withTenant` con el `tenantId` devuelto.
 */
export async function buscarPorHashDeToken(db: Pick<pg.Pool, 'query'>, hash: string): Promise<{ tenantId: string; envioId: string } | null> {
  const r = await db.query<{ tenant_id: string; envio_id: string }>('SELECT tenant_id, envio_id FROM fn_envio_por_token($1)', [hash]);
  const f = r.rows[0];
  return f ? { tenantId: f.tenant_id, envioId: f.envio_id } : null;
}

export interface EnvioConToken {
  id: string;
  citaId: string;
  fechaCita: string;
  canal: 'correo' | 'whatsapp_asistido';
  estado: EstadoEnvio;
  /** Inicio de la cita: el token vence entonces. */
  venceEn: Date | null;
  respuesta: Respuesta | null;
}

interface FilaToken {
  id: string;
  cita_id: string;
  fecha_cita: string;
  canal: EnvioConToken['canal'];
  estado: EstadoEnvio;
  token_expira_en: Date | null;
  respuesta: Respuesta | null;
}

/**
 * Envío que tiene ese token. Con `bloquear` toma la fila `FOR UPDATE`: dos respuestas simultáneas se serializan y la segunda
 * ya ve la respuesta de la primera.
 */
export async function leerPorToken(tx: pg.PoolClient, tenantId: string, envioId: string, hash: string, bloquear: boolean): Promise<EnvioConToken | null> {
  const r = await tx.query<FilaToken>(
    `SELECT id, cita_id, fecha_cita::text AS fecha_cita, canal, estado, token_expira_en, respuesta FROM envio
      WHERE tenant_id = $1 AND id = $2 AND token_hash = $3${bloquear ? ' FOR UPDATE' : ''}`,
    [tenantId, envioId, hash],
  );
  const f = r.rows[0];
  return f ? { id: f.id, citaId: f.cita_id, fechaCita: f.fecha_cita, canal: f.canal, estado: f.estado, venceEn: f.token_expira_en, respuesta: f.respuesta } : null;
}

/** Guarda la respuesta del paciente (el llamador ya tiene la fila bloqueada). */
export async function guardarRespuestaDePaciente(tx: pg.PoolClient, envioId: string, respuesta: Respuesta, ahora: Date): Promise<void> {
  await tx.query(`UPDATE envio SET respuesta = $2, respondido_en = $3, respondido_por = 'paciente' WHERE id = $1`, [envioId, respuesta, ahora]);
}
