import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { iniciarNotificaciones, type Notificaciones } from './helpers.js';

let n: Notificaciones;
const A = uuidv7();
const B = uuidv7();

beforeAll(async () => {
  n = await iniciarNotificaciones();
});
afterAll(async () => {
  await n.stop();
});

const INSERT_ENVIO = `INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal) VALUES ($1, $2, $3, '2030-01-07', 'correo')`;
const INSERT_CONFIG = `INSERT INTO config_recordatorios (tenant_id, zona_horaria, plantilla_correo_asunto, plantilla_correo_cuerpo, plantilla_whatsapp, actualizada_por)
  VALUES ($1, 'America/Mexico_City', 'a', 'b', 'c', $2)`;

async function sembrar(tenant: string): Promise<void> {
  await withTenant(n.appPool, tenant, async (tx) => {
    await tx.query(INSERT_CONFIG, [tenant, uuidv7()]);
    await tx.query(INSERT_ENVIO, [uuidv7(), tenant, uuidv7()]);
    await tx.query("INSERT INTO corrida (tenant_id, fecha_envio) VALUES ($1, '2030-01-06')", [tenant]);
    await tx.query("INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, 'America/Mexico_City')", [tenant]);
  });
}

const TABLAS = ['config_recordatorios', 'envio', 'corrida', 'consultorio'] as const;
type Tabla = (typeof TABLAS)[number];

const ACTUALIZACION: Record<Tabla, string> = {
  config_recordatorios: "plantilla_whatsapp = 'x'",
  envio: "estado = 'anulado'",
  corrida: "fecha_envio = '2030-02-01'",
  consultorio: "zona_horaria = 'UTC'",
};

describe('aislamiento entre tenants (notificaciones_app)', () => {
  beforeAll(async () => {
    await sembrar(A);
    await sembrar(B);
  });

  test.each(TABLAS)('%s: cada tenant solo ve sus filas y sin tenant no ve ninguna', async (tabla) => {
    for (const t of [A, B]) {
      const filas = await withTenant(n.appPool, t, async (tx) => (await tx.query<{ tenant_id: string }>(`SELECT tenant_id FROM ${tabla}`)).rows);
      expect(filas).toHaveLength(1);
      expect(filas[0]!.tenant_id).toBe(t);
    }
    expect((await n.appPool.query(`SELECT 1 FROM ${tabla}`)).rowCount).toBe(0);
  });

  test.each(TABLAS)('%s: no puede modificar ni borrar filas de otro tenant', async (tabla) => {
    const { upd, del } = await withTenant(n.appPool, A, async (tx) => ({
      upd: (await tx.query(`UPDATE ${tabla} SET ${ACTUALIZACION[tabla]} WHERE tenant_id = $1`, [B])).rowCount,
      del: (await tx.query(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [B])).rowCount,
    }));
    expect([upd, del]).toEqual([0, 0]);
    expect(await withTenant(n.appPool, B, async (tx) => (await tx.query(`SELECT 1 FROM ${tabla}`)).rowCount)).toBe(1);
  });

  test.each(TABLAS)('%s: no puede insertar filas con el tenant_id de otro (WITH CHECK)', async (tabla) => {
    const insertar: Record<Tabla, [string, unknown[]]> = {
      config_recordatorios: [INSERT_CONFIG, [B, uuidv7()]],
      envio: [INSERT_ENVIO, [uuidv7(), B, uuidv7()]],
      corrida: ["INSERT INTO corrida (tenant_id, fecha_envio) VALUES ($1, '2031-01-01')", [B]],
      consultorio: ["INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, 'UTC')", [B]],
    };
    const [sql, params] = insertar[tabla];
    await expect(withTenant(n.appPool, A, (tx) => tx.query(sql, params))).rejects.toThrow(/row-level security/);
  });
});

describe('invariantes en la base', () => {
  test('un envío por cita, fecha y canal; otro canal u otra fecha sí se permite', async () => {
    const T = uuidv7();
    const cita = uuidv7();
    const ins = (fecha: string, canal: string) =>
      withTenant(n.appPool, T, (tx) => tx.query('INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), T, cita, fecha, canal]));
    await ins('2030-03-01', 'correo');
    await expect(ins('2030-03-01', 'correo')).rejects.toMatchObject({ code: '23505' });
    await ins('2030-03-01', 'whatsapp_asistido');
    await ins('2030-03-02', 'correo');
  });

  test('estado, canal y respuesta fuera de catálogo se rechazan', async () => {
    const T = uuidv7();
    const mal = (campo: string, valor: string) =>
      withTenant(n.appPool, T, (tx) =>
        tx.query(`INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, ${campo}) VALUES ($1, $2, $3, '2030-04-01', 'correo', $4)`, [uuidv7(), T, uuidv7(), valor]),
      );
    await expect(mal('estado', 'raro')).rejects.toMatchObject({ code: '23514' });
    await expect(mal('respuesta', 'quizas')).rejects.toMatchObject({ code: '23514' });
    await expect(
      withTenant(n.appPool, T, (tx) => tx.query("INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal) VALUES ($1, $2, $3, '2030-04-01', 'sms')", [uuidv7(), T, uuidv7()])),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
