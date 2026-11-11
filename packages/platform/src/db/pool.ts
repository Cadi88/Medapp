import pg from 'pg';

export interface PoolOptions {
  /**
   * Tiempo máximo para obtener una conexión nueva (por defecto 5 s). Sin él, `connect` contra una base
   * que no responde se cuelga hasta el timeout TCP (~2 min), más que el `ack_wait` de los consumidores.
   */
  connectionTimeoutMillis?: number;
  /** Destino de los errores de conexiones ociosas (por defecto `console.error`). */
  logger?: { error(obj: { err: unknown }, msg: string): void };
}

const MSG_ERROR_OCIOSA = 'error en una conexión ociosa del pool de Postgres';

export function createPool(url: string, o: PoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: o.connectionTimeoutMillis ?? 5000 });
  // Un error en una conexión ociosa no debe tumbar el proceso (evento 'error' sin manejador lanza),
  // pero tampoco se ignora: se registra (failover de RDS, reinicio, red).
  pool.on('error', (err) => {
    if (o.logger) o.logger.error({ err }, MSG_ERROR_OCIOSA);
    else console.error(`${MSG_ERROR_OCIOSA}:`, err.message);
  });
  return pool;
}
