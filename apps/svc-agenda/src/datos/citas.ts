import type { Cita, CitaParaRecordatorio, EstadoCitaDto } from '@consultorio/contracts';
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
  pide_cambio: boolean;
  version: number;
}

const COLUMNAS = `id, medico_id, tipo_cita_id, lower(rango) AS inicio, upper(rango) AS fin, estado, contacto_nombre, contacto_telefono,
  contacto_email, notas, fuera_de_horario, pide_cambio, version`;

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
  pideCambio: f.pide_cambio,
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

/** Reprograma con control optimista: `null` si la versión ya no es la indicada. La cita vuelve a `agendada` y se limpia `pide_cambio`. */
export async function reprogramarCita(
  tx: pg.PoolClient,
  tenantId: string,
  id: string,
  version: number,
  c: { medicoId: string; tipoCitaId: string; inicio: string; fin: string; fueraDeHorario: boolean },
): Promise<Cita | null> {
  const r = await tx.query<Fila>(
    `UPDATE cita SET medico_id = $4, tipo_cita_id = $5, rango = tstzrange($6::timestamptz, $7::timestamptz), fuera_de_horario = $8,
            estado = 'agendada', pide_cambio = false, version = version + 1, actualizada_en = now()
      WHERE tenant_id = $1 AND id = $2 AND version = $3
      RETURNING ${COLUMNAS}`,
    [tenantId, id, version, c.medicoId, c.tipoCitaId, c.inicio, c.fin, c.fueraDeHorario],
  );
  return r.rows[0] ? aCita(r.rows[0]) : null;
}

/** Cambia el estado (y `pide_cambio`, que el dominio decide) con control optimista: `null` si la versión ya no es la indicada. */
export async function cambiarEstadoCita(tx: pg.PoolClient, tenantId: string, id: string, version: number, estado: EstadoCitaDto, pideCambio: boolean): Promise<Cita | null> {
  const r = await tx.query<Fila>(
    `UPDATE cita SET estado = $4, pide_cambio = $5, version = version + 1, actualizada_en = now()
      WHERE tenant_id = $1 AND id = $2 AND version = $3
      RETURNING ${COLUMNAS}`,
    [tenantId, id, version, estado, pideCambio],
  );
  return r.rows[0] ? aCita(r.rows[0]) : null;
}

/** Marca que el paciente pidió cambio, con control optimista: `null` si la versión ya no es la indicada. */
export async function marcarPideCambio(tx: pg.PoolClient, tenantId: string, id: string, version: number): Promise<Cita | null> {
  const r = await tx.query<Fila>(
    `UPDATE cita SET pide_cambio = true, version = version + 1, actualizada_en = now()
      WHERE tenant_id = $1 AND id = $2 AND version = $3
      RETURNING ${COLUMNAS}`,
    [tenantId, id, version],
  );
  return r.rows[0] ? aCita(r.rows[0]) : null;
}

interface FilaRecordatorio {
  id: string;
  version: number;
  inicio: Date;
  fin: Date;
  estado: 'agendada' | 'confirmada';
  pide_cambio: boolean;
  medico_id: string;
  medico_nombre: string;
  tipo_cita_nombre: string;
  contacto_nombre: string;
  contacto_telefono: string;
  contacto_email: string | null;
}

/** Citas agendadas o confirmadas que empiezan en [desde, hasta), por orden de inicio. */
export async function citasParaRecordatorio(tx: pg.PoolClient, tenantId: string, desde: Date, hasta: Date): Promise<CitaParaRecordatorio[]> {
  const r = await tx.query<FilaRecordatorio>(
    `SELECT c.id, c.version, lower(c.rango) AS inicio, upper(c.rango) AS fin, c.estado, c.pide_cambio, c.medico_id, m.nombre AS medico_nombre,
            t.nombre AS tipo_cita_nombre, c.contacto_nombre, c.contacto_telefono, c.contacto_email
     FROM cita c
     JOIN medico m ON m.tenant_id = c.tenant_id AND m.usuario_id = c.medico_id
     JOIN tipo_cita t ON t.tenant_id = c.tenant_id AND t.id = c.tipo_cita_id
     WHERE c.tenant_id = $1 AND c.estado IN ('agendada', 'confirmada') AND lower(c.rango) >= $2 AND lower(c.rango) < $3
     ORDER BY lower(c.rango), c.id`,
    [tenantId, desde, hasta],
  );
  return r.rows.map((f) => ({
    citaId: f.id,
    version: f.version,
    inicio: f.inicio.toISOString(),
    fin: f.fin.toISOString(),
    estado: f.estado,
    pideCambio: f.pide_cambio,
    medicoId: f.medico_id,
    medicoNombre: f.medico_nombre,
    tipoCitaNombre: f.tipo_cita_nombre,
    contacto: { nombre: f.contacto_nombre, telefono: f.contacto_telefono, email: f.contacto_email },
  }));
}
