import type { BloqueHorarioDto } from '@consultorio/contracts';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import type { BloqueHorario } from '../dominio/tipos.js';

export async function leerHorario(tx: pg.PoolClient, tenantId: string, medicoId: string): Promise<BloqueHorario[]> {
  const r = await tx.query<{ dia_semana: BloqueHorario['diaSemana']; inicio: string; fin: string }>(
    `SELECT dia_semana, to_char(hora_inicio, 'HH24:MI') AS inicio, to_char(hora_fin, 'HH24:MI') AS fin
       FROM horario WHERE tenant_id = $1 AND medico_id = $2 ORDER BY dia_semana, hora_inicio`,
    [tenantId, medicoId],
  );
  return r.rows.map((f) => ({ diaSemana: f.dia_semana, horaInicio: f.inicio, horaFin: f.fin }));
}

/** Reemplaza la semana completa; atómico solo si `tx` es la transacción del llamador. */
export async function reemplazarHorario(tx: pg.PoolClient, tenantId: string, medicoId: string, bloques: BloqueHorarioDto[]): Promise<void> {
  await tx.query('DELETE FROM horario WHERE tenant_id = $1 AND medico_id = $2', [tenantId, medicoId]);
  for (const b of bloques) {
    await tx.query('INSERT INTO horario (id, tenant_id, medico_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, $4, $5, $6)', [
      uuidv7(),
      tenantId,
      medicoId,
      b.diaSemana,
      b.horaInicio,
      b.horaFin,
    ]);
  }
}
