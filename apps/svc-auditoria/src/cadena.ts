import type { EventEnvelope } from '@consultorio/contracts';
import type pg from 'pg';
import { HASH_GENESIS, calcularHash, construirRegistro } from './registro.js';

export { HASH_GENESIS, calcularHash } from './registro.js';
export type { RegistroAuditoria } from './registro.js';

/**
 * Anexa `e` a la cadena de su tenant. Debe ejecutarse dentro de `withTenant(e.tenant_id)`.
 * El encabezado de la cadena se crea si falta (`ON CONFLICT DO NOTHING`) y se bloquea con `FOR UPDATE`:
 * los registros del mismo tenant se serializan, sin huecos ni secuencias duplicadas, aunque dos
 * primeros eventos de un tenant nuevo compitan (el segundo `INSERT` espera al commit del primero).
 */
export async function registrar(tx: pg.PoolClient, e: EventEnvelope): Promise<void> {
  await tx.query('INSERT INTO cadena (tenant_id, ultima_secuencia, ultimo_hash) VALUES ($1, 0, $2) ON CONFLICT DO NOTHING', [
    e.tenant_id,
    HASH_GENESIS,
  ]);
  const { rows } = await tx.query<{ ultima_secuencia: string; ultimo_hash: string }>(
    'SELECT ultima_secuencia, ultimo_hash FROM cadena WHERE tenant_id = $1 FOR UPDATE',
    [e.tenant_id],
  );
  const cabeza = rows[0];
  if (!cabeza) throw new Error('no se pudo bloquear la cadena de auditoría (¿tenant distinto al de la transacción?)');

  const registro = construirRegistro(e, BigInt(cabeza.ultima_secuencia) + 1n, cabeza.ultimo_hash);
  const hash = calcularHash(cabeza.ultimo_hash, registro);
  await tx.query(
    `INSERT INTO evento_auditoria
       (id, tenant_id, secuencia, ocurrido_en, actor_id, accion, recurso_tipo, recurso_id, servicio, detalle, hash_anterior, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
    [
      registro.id,
      registro.tenant_id,
      registro.secuencia,
      registro.ocurrido_en,
      registro.actor_id,
      registro.accion,
      registro.recurso_tipo,
      registro.recurso_id,
      registro.servicio,
      JSON.stringify(registro.detalle),
      registro.hash_anterior,
      hash,
    ],
  );
  await tx.query('UPDATE cadena SET ultima_secuencia = $2, ultimo_hash = $3 WHERE tenant_id = $1', [e.tenant_id, registro.secuencia, hash]);
}
