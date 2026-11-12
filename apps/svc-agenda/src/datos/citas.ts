import type { Cita, EstadoCitaDto } from '@consultorio/contracts';
import type pg from 'pg';

interface Fila {
  id: string;
  medico_id: string;
  tipo_cita_id: string;
  inicio: Date;
  fin: Date;
  estado: EstadoCitaDto;
  contacto_nombre: string;
  contacto_telefono: string;
  contacto_email: string | null;
  notas: string | null;
  fuera_de_horario: boolean;
  version: number;
}

const COLUMNAS = `id, medico_id, tipo_cita_id, lower(rango) AS inicio, upper(rango) AS fin, estado, contacto_nombre, contacto_telefono,
  contacto_email, notas, fuera_de_horario, version`;

const aCita = (f: Fila): Cita => ({
  id: f.id,
  medicoId: f.medico_id,
  tipoCitaId: f.tipo_cita_id,
  inicio: f.inicio.toISOString(),
  fin: f.fin.toISOString(),
  estado: f.estado,
  contacto: { nombre: f.contacto_nombre, telefono: f.contacto_telefono, ...(f.contacto_email ? { email: f.contacto_email } : {}) },
  ...(f.notas ? { notas: f.notas } : {}),
  fueraDeHorario: f.fuera_de_horario,
  version: f.version,
});

export interface NuevaCita {
  id: string;
  medicoId: string;
  tipoCitaId: string;
  inicio: string;
  fin: string;
  contacto: Cita['contacto'];
  notas?: string | undefined;
  fueraDeHorario: boolean;
  creadaPor: string;
}

export async function insertarCita(tx: pg.PoolClient, tenantId: string, c: NuevaCita): Promise<Cita> {
  const r = await tx.query<Fila>(
    `INSERT INTO cita (id, tenant_id, medico_id, tipo_cita_id, rango, estado, contacto_nombre, contacto_telefono, contacto_email, notas,
                       fuera_de_horario, origen, creada_por)
     VALUES ($1, $2, $3, $4, tstzrange($5::timestamptz, $6::timestamptz), 'agendada', $7, $8, $9, $10, $11, 'recepcion', $12)
     RETURNING ${COLUMNAS}`,
    [c.id, tenantId, c.medicoId, c.tipoCitaId, c.inicio, c.fin, c.contacto.nombre, c.contacto.telefono, c.contacto.email ?? null, c.notas ?? null, c.fueraDeHorario, c.creadaPor],
  );
  return aCita(r.rows[0]!);
}

export async function leerCita(tx: pg.PoolClient, tenantId: string, id: string): Promise<Cita | null> {
  const r = await tx.query<Fila>(`SELECT ${COLUMNAS} FROM cita WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return r.rows[0] ? aCita(r.rows[0]) : null;
}

/** Citas que tocan `[desde, hasta)` por inicio; `medicoId` ausente = todos los médicos del tenant. */
export async function listarCitas(tx: pg.PoolClient, tenantId: string, desde: string, hasta: string, medicoId?: string): Promise<Cita[]> {
  const r = await tx.query<Fila>(
    `SELECT ${COLUMNAS} FROM cita
      WHERE tenant_id = $1 AND ($4::uuid IS NULL OR medico_id = $4) AND rango && tstzrange($2::timestamptz, $3::timestamptz)
      ORDER BY lower(rango), id`,
    [tenantId, desde, hasta, medicoId ?? null],
  );
  return r.rows.map(aCita);
}

/** Reprograma con control optimista: `null` si la versión ya no es la indicada. La cita vuelve a `agendada`. */
export async function reprogramarCita(
  tx: pg.PoolClient,
  tenantId: string,
  id: string,
  version: number,
  c: { medicoId: string; tipoCitaId: string; inicio: string; fin: string; fueraDeHorario: boolean },
): Promise<Cita | null> {
  const r = await tx.query<Fila>(
    `UPDATE cita SET medico_id = $4, tipo_cita_id = $5, rango = tstzrange($6::timestamptz, $7::timestamptz), fuera_de_horario = $8,
            estado = 'agendada', version = version + 1, actualizada_en = now()
      WHERE tenant_id = $1 AND id = $2 AND version = $3
      RETURNING ${COLUMNAS}`,
    [tenantId, id, version, c.medicoId, c.tipoCitaId, c.inicio, c.fin, c.fueraDeHorario],
  );
  return r.rows[0] ? aCita(r.rows[0]) : null;
}

/** Cambia el estado con control optimista: `null` si la versión ya no es la indicada. */
export async function cambiarEstadoCita(tx: pg.PoolClient, tenantId: string, id: string, version: number, estado: EstadoCitaDto): Promise<Cita | null> {
  const r = await tx.query<Fila>(
    `UPDATE cita SET estado = $4, version = version + 1, actualizada_en = now()
      WHERE tenant_id = $1 AND id = $2 AND version = $3
      RETURNING ${COLUMNAS}`,
    [tenantId, id, version, estado],
  );
  return r.rows[0] ? aCita(r.rows[0]) : null;
}
