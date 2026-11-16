import type pg from 'pg';
import type { ModoRecordatorios } from '../dominio/calendario.js';
import { PLANTILLAS_POR_OMISION, type Plantillas } from '../dominio/plantillas.js';

export interface ConfigRecordatorios {
  modo: ModoRecordatorios;
  /** `HH:mm:ss` (tipo `time` de Postgres). */
  horaEnvio: string;
  plantillas: Plantillas;
}

export const CONFIG_POR_OMISION: ConfigRecordatorios = { modo: 'con_revision', horaEnvio: '10:00:00', plantillas: PLANTILLAS_POR_OMISION };

/** Configuración del tenant activo; sin fila rige la de por omisión. */
export async function leerConfig(tx: pg.PoolClient, tenantId: string): Promise<ConfigRecordatorios> {
  const r = await tx.query<{ modo: ModoRecordatorios; hora_envio: string; asunto: string; cuerpo: string; whatsapp: string }>(
    `SELECT modo, hora_envio::text AS hora_envio, plantilla_correo_asunto AS asunto, plantilla_correo_cuerpo AS cuerpo, plantilla_whatsapp AS whatsapp
       FROM config_recordatorios WHERE tenant_id = $1`,
    [tenantId],
  );
  const f = r.rows[0];
  if (!f) return CONFIG_POR_OMISION;
  return { modo: f.modo, horaEnvio: f.hora_envio, plantillas: { correoAsunto: f.asunto, correoCuerpo: f.cuerpo, whatsapp: f.whatsapp } };
}
