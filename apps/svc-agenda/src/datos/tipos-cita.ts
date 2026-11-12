import type { TipoCita } from '@consultorio/contracts';
import type pg from 'pg';

interface Fila {
  id: string;
  medico_id: string;
  nombre: string;
  duracion_min: number;
  activo: boolean;
}

const COLUMNAS = 'id, medico_id, nombre, duracion_min, activo';

const aTipo = (f: Fila): TipoCita => ({ id: f.id, medicoId: f.medico_id, nombre: f.nombre, duracionMin: f.duracion_min, activo: f.activo });

export async function listarTiposCita(tx: pg.PoolClient, tenantId: string, medicoId: string, incluirInactivos: boolean): Promise<TipoCita[]> {
  const r = await tx.query<Fila>(
    `SELECT ${COLUMNAS} FROM tipo_cita WHERE tenant_id = $1 AND medico_id = $2 AND (activo OR $3) ORDER BY nombre, id`,
    [tenantId, medicoId, incluirInactivos],
  );
  return r.rows.map(aTipo);
}

export async function leerTipoCita(tx: pg.PoolClient, tenantId: string, medicoId: string, id: string): Promise<TipoCita | null> {
  const r = await tx.query<Fila>(`SELECT ${COLUMNAS} FROM tipo_cita WHERE tenant_id = $1 AND medico_id = $2 AND id = $3`, [tenantId, medicoId, id]);
  return r.rows[0] ? aTipo(r.rows[0]) : null;
}

export async function insertarTipoCita(tx: pg.PoolClient, tenantId: string, t: Omit<TipoCita, 'activo'>): Promise<TipoCita> {
  const r = await tx.query<Fila>(
    `INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNAS}`,
    [t.id, tenantId, t.medicoId, t.nombre, t.duracionMin],
  );
  return aTipo(r.rows[0]!);
}

export async function actualizarTipoCita(
  tx: pg.PoolClient,
  tenantId: string,
  medicoId: string,
  id: string,
  cambios: { nombre?: string | undefined; duracionMin?: number | undefined; activo?: boolean | undefined },
): Promise<TipoCita | null> {
  const r = await tx.query<Fila>(
    `UPDATE tipo_cita SET nombre = COALESCE($4, nombre), duracion_min = COALESCE($5, duracion_min), activo = COALESCE($6, activo)
      WHERE tenant_id = $1 AND medico_id = $2 AND id = $3 RETURNING ${COLUMNAS}`,
    [tenantId, medicoId, id, cambios.nombre ?? null, cambios.duracionMin ?? null, cambios.activo ?? null],
  );
  return r.rows[0] ? aTipo(r.rows[0]) : null;
}
