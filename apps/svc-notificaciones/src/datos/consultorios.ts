import type pg from 'pg';

/** Registra el consultorio para el programador; si ya existe no cambia nada (la zona la fija identidad al crearlo). */
export async function registrarConsultorio(tx: pg.PoolClient, tenantId: string, zonaHoraria: string): Promise<void> {
  await tx.query('INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING', [tenantId, zonaHoraria]);
}

export async function leerZonaHoraria(tx: pg.PoolClient, tenantId: string): Promise<string | null> {
  const r = await tx.query<{ zona_horaria: string }>('SELECT zona_horaria FROM consultorio WHERE tenant_id = $1', [tenantId]);
  return r.rows[0]?.zona_horaria ?? null;
}

/** Todos los consultorios conocidos (función SECURITY DEFINER: el programador recorre los tenants sin tenant activo). */
export async function listarConsultorios(db: Pick<pg.PoolClient, 'query'>): Promise<{ tenantId: string; zonaHoraria: string }[]> {
  const r = await db.query<{ tenant_id: string; zona_horaria: string }>('SELECT tenant_id, zona_horaria FROM fn_consultorios()');
  return r.rows.map((f) => ({ tenantId: f.tenant_id, zonaHoraria: f.zona_horaria }));
}
