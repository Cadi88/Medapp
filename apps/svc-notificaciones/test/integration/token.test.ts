import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { generarToken } from '../../src/dominio/token.js';
import { iniciarNotificaciones, type Notificaciones } from './helpers.js';

let n: Notificaciones;
beforeAll(async () => {
  n = await iniciarNotificaciones();
});
afterAll(async () => {
  await n.stop();
});

describe('fn_envio_por_token', () => {
  test('encuentra el envío sin tenant fijado y devuelve solo tenant_id y envio_id', async () => {
    const T = uuidv7();
    const id = uuidv7();
    const { hash } = generarToken();
    await withTenant(n.appPool, T, (tx) =>
      tx.query(
        "INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, token_hash, token_expira_en) VALUES ($1, $2, $3, '2030-05-01', 'correo', $4, now() + interval '1 day')",
        [id, T, uuidv7(), hash],
      ),
    );
    // Sin app.tenant_id: la tabla no se ve, pero la función sí encuentra el envío.
    expect((await n.appPool.query('SELECT 1 FROM envio')).rowCount).toBe(0);
    const r = await n.appPool.query('SELECT * FROM fn_envio_por_token($1)', [hash]);
    expect(r.rows).toEqual([{ tenant_id: T, envio_id: id }]);
    expect(r.fields.map((f) => f.name)).toEqual(['tenant_id', 'envio_id']);
  });

  test('devuelve vacío para un hash desconocido', async () => {
    const r = await n.appPool.query('SELECT * FROM fn_envio_por_token($1)', [generarToken().hash]);
    expect(r.rows).toEqual([]);
  });

  test('un token no se puede repetir en dos envíos', async () => {
    const T = uuidv7();
    const { hash } = generarToken();
    const ins = () =>
      withTenant(n.appPool, T, (tx) => tx.query("INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, token_hash) VALUES ($1, $2, $3, '2030-06-01', 'correo', $4)", [uuidv7(), T, uuidv7(), hash]));
    await ins();
    await expect(ins()).rejects.toMatchObject({ code: '23505' });
  });

  test('PUBLIC no puede ejecutarla: solo el rol de la aplicación', async () => {
    const r = await n.migrator.query<{ ok: boolean }>("SELECT has_function_privilege('public', 'fn_envio_por_token(text)', 'EXECUTE') AS ok");
    expect(r.rows[0]!.ok).toBe(false);
  });

  test('/salud responde', async () => {
    const res = await n.app.inject({ method: 'GET', url: '/salud' });
    expect(res.statusCode).toBe(200);
  });
});
