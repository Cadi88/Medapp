import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { iniciarAgenda, type Agenda } from './helpers.js';

let ag: Agenda;
const A = uuidv7();
const B = uuidv7();
const medicoA = uuidv7();
const medicoB = uuidv7();
const tipoA = uuidv7();
const tipoB = uuidv7();

beforeAll(async () => {
  ag = await iniciarAgenda();
});
afterAll(async () => {
  await ag.stop();
});

const inicio = '2030-01-07T15:00:00Z';
const fin = '2030-01-07T15:30:00Z';

const INSERT_CITA = `INSERT INTO cita (id, tenant_id, medico_id, tipo_cita_id, rango, estado, contacto_nombre, contacto_telefono, origen, creada_por)
  VALUES ($1, $2, $3, $4, tstzrange($5, $6), $7, 'Paciente', '5555555555', 'recepcion', $8)`;

/** Una fila por tabla, insertada con la RLS del tenant dado. */
async function sembrar(tenant: string, medico: string, tipo: string): Promise<void> {
  await withTenant(ag.appPool, tenant, async (tx) => {
    await tx.query('INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, $2)', [tenant, 'America/Mexico_City']);
    await tx.query('INSERT INTO medico (tenant_id, usuario_id, nombre) VALUES ($1, $2, $3)', [tenant, medico, 'Dr. X']);
    await tx.query('INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, $4, 30)', [tipo, tenant, medico, 'Consulta']);
    await tx.query("INSERT INTO horario (id, tenant_id, medico_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, 1, '09:00', '14:00')", [uuidv7(), tenant, medico]);
    await tx.query('INSERT INTO bloqueo (id, tenant_id, medico_id, rango, motivo) VALUES ($1, $2, $3, tstzrange($4, $5), $6)', [uuidv7(), tenant, medico, inicio, fin, 'Congreso']);
    await tx.query(INSERT_CITA, [uuidv7(), tenant, medico, tipo, inicio, fin, 'agendada', uuidv7()]);
  });
}

const TABLAS = ['consultorio', 'medico', 'tipo_cita', 'horario', 'bloqueo', 'cita'] as const;
type Tabla = (typeof TABLAS)[number];

const ACTUALIZACION: Record<Tabla, string> = {
  consultorio: "zona_horaria = 'UTC'",
  medico: "nombre = 'x'",
  tipo_cita: "nombre = 'x'",
  horario: "hora_fin = '15:00'",
  bloqueo: "motivo = 'x'",
  cita: "notas = 'x'",
};

describe('aislamiento entre tenants (agenda_app)', () => {
  beforeAll(async () => {
    await sembrar(A, medicoA, tipoA);
    await sembrar(B, medicoB, tipoB);
  });

  test.each(TABLAS)('%s: cada tenant solo ve sus filas y sin tenant no ve ninguna', async (tabla) => {
    for (const t of [A, B]) {
      const filas = await withTenant(ag.appPool, t, async (tx) => (await tx.query<{ tenant_id: string }>(`SELECT tenant_id FROM ${tabla}`)).rows);
      expect(filas).toHaveLength(1);
      expect(filas[0]!.tenant_id).toBe(t);
    }
    expect((await ag.appPool.query(`SELECT 1 FROM ${tabla}`)).rowCount).toBe(0);
  });

  test.each(TABLAS)('%s: no puede modificar ni borrar filas de otro tenant', async (tabla) => {
    const { upd, del } = await withTenant(ag.appPool, A, async (tx) => ({
      upd: (await tx.query(`UPDATE ${tabla} SET ${ACTUALIZACION[tabla]} WHERE tenant_id = $1`, [B])).rowCount,
      del: (await tx.query(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [B])).rowCount,
    }));
    expect([upd, del]).toEqual([0, 0]);
    expect(await withTenant(ag.appPool, B, async (tx) => (await tx.query(`SELECT 1 FROM ${tabla}`)).rowCount)).toBe(1);
  });

  test.each(TABLAS)('%s: no puede insertar filas con el tenant_id de otro (WITH CHECK)', async (tabla) => {
    const r1 = '2031-01-01T10:00:00Z';
    const r2 = '2031-01-01T11:00:00Z';
    const insertar: Record<Tabla, [string, unknown[]]> = {
      consultorio: ['INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, $2)', [B, 'UTC']],
      medico: ['INSERT INTO medico (tenant_id, usuario_id, nombre) VALUES ($1, $2, $3)', [B, uuidv7(), 'Intruso']],
      tipo_cita: ['INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, $4, 30)', [uuidv7(), B, medicoB, 'Otro']],
      horario: ["INSERT INTO horario (id, tenant_id, medico_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, 3, '09:00', '10:00')", [uuidv7(), B, medicoB]],
      bloqueo: ['INSERT INTO bloqueo (id, tenant_id, medico_id, rango) VALUES ($1, $2, $3, tstzrange($4, $5))', [uuidv7(), B, medicoB, r1, r2]],
      cita: [INSERT_CITA, [uuidv7(), B, medicoB, tipoB, r1, r2, 'agendada', uuidv7()]],
    };
    const [sql, params] = insertar[tabla];
    await expect(withTenant(ag.appPool, A, (tx) => tx.query(sql, params))).rejects.toThrow(/row-level security/);
  });
});

describe('invariantes en la base', () => {
  test('horarios encimados del mismo médico y día → violación de exclusión', async () => {
    const T = uuidv7();
    const m = uuidv7();
    await ag.sembrarMedico(T, m, 'Dra. H');
    const ins = (dia: number, ini: string, fin: string) =>
      withTenant(ag.appPool, T, (tx) =>
        tx.query('INSERT INTO horario (id, tenant_id, medico_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, $4, $5, $6)', [uuidv7(), T, m, dia, ini, fin]),
      );
    await ins(2, '09:00', '13:00');
    await expect(ins(2, '12:00', '15:00')).rejects.toMatchObject({ code: '23P01' });
    await ins(2, '13:00', '15:00'); // contiguo: permitido
    await ins(3, '12:00', '15:00'); // otro día: permitido
  });

  test('citas encimadas violan la exclusión, salvo si la previa está cancelada', async () => {
    const T = uuidv7();
    const m = uuidv7();
    const tipo = uuidv7();
    await ag.sembrarMedico(T, m, 'Dr. C');
    await withTenant(ag.appPool, T, (tx) => tx.query('INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, $4, 30)', [tipo, T, m, 'Consulta']));
    const cita = (estado: string, ini: string, fin: string) => withTenant(ag.appPool, T, (tx) => tx.query(INSERT_CITA, [uuidv7(), T, m, tipo, ini, fin, estado, uuidv7()]));
    await cita('cancelada', '2030-02-01T10:00:00Z', '2030-02-01T10:30:00Z');
    await cita('agendada', '2030-02-01T10:00:00Z', '2030-02-01T10:30:00Z');
    await expect(cita('agendada', '2030-02-01T10:15:00Z', '2030-02-01T10:45:00Z')).rejects.toMatchObject({ code: '23P01' });
    await cita('agendada', '2030-02-01T10:30:00Z', '2030-02-01T11:00:00Z');
  });

  test('duración fuera de 5..480 y nombre de tipo activo duplicado se rechazan', async () => {
    const T = uuidv7();
    const m = uuidv7();
    await ag.sembrarMedico(T, m, 'Dr. D');
    const tipo = (nombre: string, dur: number, activo = true) =>
      withTenant(ag.appPool, T, (tx) =>
        tx.query('INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min, activo) VALUES ($1, $2, $3, $4, $5, $6)', [uuidv7(), T, m, nombre, dur, activo]),
      );
    await expect(tipo('Corta', 4)).rejects.toMatchObject({ code: '23514' });
    await expect(tipo('Larga', 481)).rejects.toMatchObject({ code: '23514' });
    await tipo('Consulta', 30);
    await expect(tipo('CONSULTA', 45)).rejects.toMatchObject({ code: '23505' });
    await tipo('consulta', 45, false); // inactivo: permitido
  });
});
