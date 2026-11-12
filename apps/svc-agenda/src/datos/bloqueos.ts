import type { Bloqueo } from '@consultorio/contracts';
import { DateTime } from 'luxon';
import type pg from 'pg';
import type { Rango } from '../dominio/tipos.js';

interface Fila {
  id: string;
  medico_id: string;
  inicio: Date;
  fin: Date;
  motivo: string | null;
}

const COLUMNAS = 'id, medico_id, lower(rango) AS inicio, upper(rango) AS fin, motivo';

const aBloqueo = (f: Fila): Bloqueo => ({ id: f.id, medicoId: f.medico_id, inicio: f.inicio.toISOString(), fin: f.fin.toISOString(), motivo: f.motivo });

/** Bloqueos que se traslapan con `[desde, hasta)`; un extremo ausente queda abierto. */
export async function listarBloqueos(tx: pg.PoolClient, tenantId: string, medicoId: string, desde?: string, hasta?: string): Promise<Bloqueo[]> {
  const r = await tx.query<Fila>(
    `SELECT ${COLUMNAS} FROM bloqueo
      WHERE tenant_id = $1 AND medico_id = $2
        AND rango && tstzrange($3::timestamptz, $4::timestamptz)
      ORDER BY lower(rango), id`,
    [tenantId, medicoId, desde ?? null, hasta ?? null],
  );
  return r.rows.map(aBloqueo);
}

export async function insertarBloqueo(
  tx: pg.PoolClient,
  tenantId: string,
  b: { id: string; medicoId: string; inicio: string; fin: string; motivo?: string | undefined },
): Promise<Bloqueo> {
  const r = await tx.query<Fila>(
    `INSERT INTO bloqueo (id, tenant_id, medico_id, rango, motivo) VALUES ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz), $6)
     RETURNING ${COLUMNAS}`,
    [b.id, tenantId, b.medicoId, b.inicio, b.fin, b.motivo ?? null],
  );
  return aBloqueo(r.rows[0]!);
}

export async function borrarBloqueo(tx: pg.PoolClient, tenantId: string, medicoId: string, id: string): Promise<boolean> {
  const r = await tx.query('DELETE FROM bloqueo WHERE tenant_id = $1 AND medico_id = $2 AND id = $3', [tenantId, medicoId, id]);
  return r.rowCount === 1;
}

/** Citas no canceladas y bloqueos del médico que tocan `[desde, hasta)`. */
export async function rangosOcupados(tx: pg.PoolClient, tenantId: string, medicoId: string, desde: DateTime, hasta: DateTime): Promise<Rango[]> {
  const r = await tx.query<{ inicio: Date; fin: Date }>(
    `SELECT lower(rango) AS inicio, upper(rango) AS fin FROM cita
      WHERE tenant_id = $1 AND medico_id = $2 AND estado <> 'cancelada' AND rango && tstzrange($3::timestamptz, $4::timestamptz)
     UNION ALL
     SELECT lower(rango), upper(rango) FROM bloqueo
      WHERE tenant_id = $1 AND medico_id = $2 AND rango && tstzrange($3::timestamptz, $4::timestamptz)`,
    [tenantId, medicoId, desde.toISO(), hasta.toISO()],
  );
  return r.rows.map((f) => ({ inicio: DateTime.fromJSDate(f.inicio, { zone: 'utc' }), fin: DateTime.fromJSDate(f.fin, { zone: 'utc' }) }));
}
