import pg from 'pg';

export function createPool(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url });
  // Un error en una conexión ociosa no debe tumbar el proceso (evento 'error' sin manejador lanza).
  pool.on('error', () => {});
  return pool;
}
