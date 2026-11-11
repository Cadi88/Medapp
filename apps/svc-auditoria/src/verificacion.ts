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
 * Recalcula la cadena del tenant desde los datos leídos de Postgres. Se fija primero el encabezado
 * (`cadena`) y solo se verifican las secuencias ≤ `ultima_secuencia`, de modo que registros
 * concurrentes posteriores no producen falsos positivos. Además del contenido se comprueba que no
 * falten registros al final y que el último hash coincida con el del encabezado.
 */
export async function verificarCadena(pool: pg.Pool, tenantId: string, o: { tamanoLote?: number } = {}): Promise<ResultadoVerificacion> {
  const tamano = o.tamanoLote ?? 500;
  const cabeza = await withTenant(pool, tenantId, async (tx) => {
    const r = await tx.query<{ ultima_secuencia: string; ultimo_hash: string }>('SELECT ultima_secuencia, ultimo_hash FROM cadena WHERE tenant_id = $1', [tenantId]);
    return r.rows[0];
  });
  if (!cabeza) return { valida: true };
  const ultima = BigInt(cabeza.ultima_secuencia);

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
  if (estado.hash !== cabeza.ultimo_hash) return { valida: false, rotaEnSecuencia: Number(ultima) };
  return { valida: true };
}
