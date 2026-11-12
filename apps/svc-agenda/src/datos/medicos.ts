import type pg from 'pg';
import type { Medico } from '../dominio/medicos.js';

/** Médico del tenant activo (la RLS de `tx` acota el tenant); bloquea la fila para serializar eventos concurrentes. */
export async function leerMedico(tx: pg.PoolClient, tenantId: string, usuarioId: string): Promise<Medico | null> {
  const r = await tx.query<{ nombre: string; activo: boolean }>(
    'SELECT nombre, activo FROM medico WHERE tenant_id = $1 AND usuario_id = $2 FOR UPDATE',
    [tenantId, usuarioId],
  );
  const f = r.rows[0];
  return f ? { nombre: f.nombre, activo: f.activo } : null;
}

export async function guardarMedico(tx: pg.PoolClient, tenantId: string, usuarioId: string, m: Medico): Promise<void> {
  await tx.query(
    `INSERT INTO medico (tenant_id, usuario_id, nombre, activo) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, usuario_id) DO UPDATE SET nombre = EXCLUDED.nombre, activo = EXCLUDED.activo`,
    [tenantId, usuarioId, m.nombre, m.activo],
  );
}

export async function guardarConsultorio(tx: pg.PoolClient, tenantId: string, zonaHoraria: string): Promise<void> {
  await tx.query(
    `INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET zona_horaria = EXCLUDED.zona_horaria`,
    [tenantId, zonaHoraria],
  );
}
