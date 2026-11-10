import type pg from 'pg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ejecuta `fn` en una transacción con `app.tenant_id` fijado localmente (set_config con is_local = true),
 * de modo que el contexto muere con la transacción y no se filtra a otras del mismo pool.
 */
export async function withTenant<T>(pool: pg.Pool, tenantId: string, fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) throw new Error('tenantId inválido');
  const client = await pool.connect();
  let destroy: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    const commit = await client.query('COMMIT');
    // Si la transacción quedó abortada, Postgres responde COMMIT con la etiqueta ROLLBACK y sin error.
    if (commit.command === 'ROLLBACK') throw new Error('transacción abortada; se hizo rollback');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Conexión en estado desconocido: no devolverla al pool.
      destroy = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
    }
    throw err;
  } finally {
    if (destroy) client.release(destroy);
    else client.release();
  }
}
