import type pg from 'pg';

/** Fecha (`YYYY-MM-DD`) de la última corrida automática del consultorio, o `null` si nunca corrió. */
export async function ultimaCorrida(tx: pg.PoolClient, tenantId: string): Promise<string | null> {
  const r = await tx.query<{ fecha: string | null }>('SELECT max(fecha_envio)::text AS fecha FROM corrida WHERE tenant_id = $1', [tenantId]);
  return r.rows[0]?.fecha ?? null;
}

/** Marca que el envío automático de `fechaEnvio` ya corrió (idempotente). */
export async function registrarCorrida(tx: pg.PoolClient, tenantId: string, fechaEnvio: string): Promise<void> {
  await tx.query('INSERT INTO corrida (tenant_id, fecha_envio) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tenantId, fechaEnvio]);
}
