import { withTenant } from '@consultorio/platform';
import type pg from 'pg';
import { HASH_GENESIS, calcularHash, registroDesdeFila, type FilaAuditoria } from './registro.js';

export interface EstadoCadena {
  /** Secuencia que debe venir a continuación. */
  siguiente: bigint;
  /** Hash del último registro verificado (génesis al inicio). */
  hash: string;
}

export interface ResultadoLote {
  estado: EstadoCadena;
  rotaEnSecuencia?: number;
}

export interface ResultadoVerificacion {
  valida: boolean;
  rotaEnSecuencia?: number;
}

/**
 * Verifica un lote consecutivo de filas contra el estado acumulado: la secuencia no tiene huecos,
 * `hash_anterior` enlaza con el hash previo y el hash almacenado coincide con el recalculado.
 * Se detiene en el primer registro roto.
 */
export function verificarLote(inicio: EstadoCadena, filas: FilaAuditoria[]): ResultadoLote {
  let estado = inicio;
  for (const f of filas) {
    const ok =
      BigInt(f.secuencia) === estado.siguiente &&
      f.hash_anterior === estado.hash &&
      calcularHash(f.hash_anterior, registroDesdeFila(f)) === f.hash;
    if (!ok) return { estado, rotaEnSecuencia: Number(estado.siguiente) };
    estado = { siguiente: estado.siguiente + 1n, hash: f.hash };
  }
  return { estado };
}

/**
 * Regla de conteo (se aplica cuando el tramo 1..`ultima` ya resultó íntegro): el tenant debe tener exactamente
 * `ultima` registros y ninguno con secuencia mayor que el encabezado. Si no, la primera secuencia problemática es
 * `ultima + 1` (registros más allá de la cabeza: cabeza rebajada o congelada). Sin encabezado, `ultima` = 0.
 */
export function secuenciaFueraDeCabeza(ultima: bigint, max: bigint | null, total: bigint): number | undefined {
  return (max ?? 0n) > ultima || total !== ultima ? Number(ultima + 1n) : undefined;
}

/**
 * Recalcula la cadena del tenant desde los datos leídos de Postgres. Encabezado (`cadena`), `max(secuencia)` y
 * `count(*)` se leen en UNA sentencia (misma instantánea), y luego se verifican las secuencias ≤ `ultima_secuencia`,
 * de modo que registros concurrentes posteriores no producen falsos positivos.
 *
 * Regla de `rotaEnSecuencia` (la primera secuencia problemática):
 *  - recorriendo 1..ultima: la primera fila faltante, fuera de orden, mal enlazada o con hash distinto;
 *  - si el último hash no coincide con el del encabezado: `ultima`;
 *  - si ese tramo es íntegro pero hay registros con secuencia > `ultima` o el total no es `ultima`: `ultima + 1`;
 *  - sin fila de encabezado pero con registros: 1 (equivale a `ultima` = 0).
 */
export async function verificarCadena(pool: pg.Pool, tenantId: string, o: { tamanoLote?: number } = {}): Promise<ResultadoVerificacion> {
  const tamano = o.tamanoLote ?? 500;
  const foto = await withTenant(pool, tenantId, async (tx) => {
    const r = await tx.query<{ ultima_secuencia: string | null; ultimo_hash: string | null; max: string | null; total: string }>(
      `SELECT c.ultima_secuencia, c.ultimo_hash, a.max, a.total
         FROM (SELECT max(secuencia) AS max, count(*) AS total FROM evento_auditoria WHERE tenant_id = $1) a
         LEFT JOIN cadena c ON c.tenant_id = $1`,
      [tenantId],
    );
    return r.rows[0]!;
  });
  const max = foto.max === null ? null : BigInt(foto.max);
  const total = BigInt(foto.total);
  if (foto.ultima_secuencia === null || foto.ultimo_hash === null) {
    const rota = secuenciaFueraDeCabeza(0n, max, total);
    return rota === undefined ? { valida: true } : { valida: false, rotaEnSecuencia: rota };
  }
  const ultima = BigInt(foto.ultima_secuencia);

  let estado: EstadoCadena = { siguiente: 1n, hash: HASH_GENESIS };
  while (estado.siguiente <= ultima) {
    const desde = estado.siguiente;
    const filas = await withTenant(pool, tenantId, async (tx) => {
      const r = await tx.query<FilaAuditoria>(
        'SELECT * FROM evento_auditoria WHERE tenant_id = $1 AND secuencia >= $2 AND secuencia <= $3 ORDER BY secuencia LIMIT $4',
        [tenantId, desde.toString(), ultima.toString(), tamano],
      );
      return r.rows;
    });
    // Sin filas antes de llegar al encabezado: faltan registros desde `desde`.
    if (filas.length === 0) return { valida: false, rotaEnSecuencia: Number(desde) };
    const r = verificarLote(estado, filas);
    if (r.rotaEnSecuencia !== undefined) return { valida: false, rotaEnSecuencia: r.rotaEnSecuencia };
    estado = r.estado;
  }
  if (estado.hash !== foto.ultimo_hash) return { valida: false, rotaEnSecuencia: Number(ultima) };
  const fuera = secuenciaFueraDeCabeza(ultima, max, total);
  return fuera === undefined ? { valida: true } : { valida: false, rotaEnSecuencia: fuera };
}
