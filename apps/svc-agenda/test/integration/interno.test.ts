import { withTenant } from '@consultorio/platform';
import { citasParaRecordatorioRespuestaSchema } from '@consultorio/contracts';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { iniciarAgenda, TOKEN_INTERNO_PRUEBA, type Agenda } from './helpers.js';

let ag: Agenda;
const T = uuidv7();
const OTRO = uuidv7();
const dr = uuidv7();
const drOtro = uuidv7();
const tipo = uuidv7();
const tipoOtro = uuidv7();
const SIN_CONSULTORIO = uuidv7();

const INSERT_CITA = `INSERT INTO cita (id, tenant_id, medico_id, tipo_cita_id, rango, estado, contacto_nombre, contacto_telefono, contacto_email, origen, creada_por)
  VALUES ($1, $2, $3, $4, tstzrange($5, $6), $7, $8, '5555555555', $9, 'recepcion', $10)`;
const citaId = { agendada: uuidv7(), confirmada: uuidv7(), cancelada: uuidv7(), atendida: uuidv7(), antes: uuidv7(), despues: uuidv7(), ajena: uuidv7() };

beforeAll(async () => {
  ag = await iniciarAgenda();
  for (const t of [T, OTRO]) await withTenant(ag.appPool, t, (tx) => tx.query("INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, 'America/Mexico_City')", [t]));
  await ag.sembrarMedico(T, dr, 'Dra. Ana');
  await ag.sembrarMedico(OTRO, drOtro, 'Dr. Ajeno');
  await ag.sembrarMedico(SIN_CONSULTORIO, uuidv7(), 'Dr. Huérfano');
  await withTenant(ag.appPool, T, async (tx) => {
    await tx.query("INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, 'Consulta general', 30)", [tipo, T, dr]);
    // Zona America/Mexico_City (UTC-6 en enero). Día local 2030-01-07 = [06:00Z, 2030-01-08 06:00Z).
    const cita = (id: string, ini: string, fin: string, estado: string, nombre: string, email: string | null) =>
      tx.query(INSERT_CITA, [id, T, dr, tipo, ini, fin, estado, nombre, email, uuidv7()]);
    await cita(citaId.agendada, '2030-01-07T17:00:00Z', '2030-01-07T17:30:00Z', 'agendada', 'Paciente Uno', 'uno@ejemplo.mx');
    await cita(citaId.confirmada, '2030-01-08T05:30:00Z', '2030-01-08T05:45:00Z', 'confirmada', 'Paciente Dos', null); // 23:30 local del 7
    await cita(citaId.cancelada, '2030-01-07T18:00:00Z', '2030-01-07T18:30:00Z', 'cancelada', 'Cancelada', null);
    await cita(citaId.atendida, '2030-01-07T19:00:00Z', '2030-01-07T19:30:00Z', 'atendida', 'Atendida', null);
    await cita(citaId.antes, '2030-01-07T05:30:00Z', '2030-01-07T05:45:00Z', 'agendada', 'Antes', null); // 23:30 local del 6
    await cita(citaId.despues, '2030-01-08T06:00:00Z', '2030-01-08T06:30:00Z', 'agendada', 'Despues', null); // 00:00 local del 8
  });
  await withTenant(ag.appPool, OTRO, async (tx) => {
    await tx.query("INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, 'Otra', 30)", [tipoOtro, OTRO, drOtro]);
    await tx.query(INSERT_CITA, [citaId.ajena, OTRO, drOtro, tipoOtro, '2030-01-07T17:00:00Z', '2030-01-07T17:30:00Z', 'agendada', 'Ajena', null, uuidv7()]);
  });
});
afterAll(async () => {
  await ag.stop();
});

const get = (query: string, token: string | null = TOKEN_INTERNO_PRUEBA) =>
  ag.app.inject({ method: 'GET', url: `/interno/citas-para-recordatorio?${query}`, ...(token ? { headers: { 'x-token-interno': token } } : {}) });

describe('GET /interno/citas-para-recordatorio', () => {
  test('sin token, con token incorrecto o con un JWT en su lugar → 404', async () => {
    const q = `tenantId=${T}&desde=2030-01-07&hasta=2030-01-07`;
    expect((await get(q, null)).statusCode).toBe(404);
    expect((await get(q, 'x'.repeat(TOKEN_INTERNO_PRUEBA.length))).statusCode).toBe(404);
    const jwt = await ag.tokenPara({ tid: T });
    const r = await ag.app.inject({ method: 'GET', url: `/interno/citas-para-recordatorio?${q}`, headers: { authorization: `Bearer ${jwt}` } });
    expect(r.statusCode).toBe(404);
  });

  test('con token: solo agendada/confirmada del rango local, con contacto, médico y tipo', async () => {
    const r = await get(`tenantId=${T}&desde=2030-01-07&hasta=2030-01-07`);
    expect(r.statusCode).toBe(200);
    const { citas } = citasParaRecordatorioRespuestaSchema.parse(r.json());
    expect(citas).toEqual([
      {
        citaId: citaId.agendada,
        version: 1,
        inicio: '2030-01-07T17:00:00.000Z',
        fin: '2030-01-07T17:30:00.000Z',
        estado: 'agendada',
        pideCambio: false,
        medicoId: dr,
        medicoNombre: 'Dra. Ana',
        tipoCitaNombre: 'Consulta general',
        contacto: { nombre: 'Paciente Uno', telefono: '5555555555', email: 'uno@ejemplo.mx' },
      },
      {
        citaId: citaId.confirmada,
        version: 1,
        inicio: '2030-01-08T05:30:00.000Z',
        fin: '2030-01-08T05:45:00.000Z',
        estado: 'confirmada',
        pideCambio: false,
        medicoId: dr,
        medicoNombre: 'Dra. Ana',
        tipoCitaNombre: 'Consulta general',
        contacto: { nombre: 'Paciente Dos', telefono: '5555555555', email: null },
      },
    ]);
  });

  test('un rango de varios días incluye las citas de los bordes locales; tenant ajeno no se mezcla', async () => {
    const r = await get(`tenantId=${T}&desde=2030-01-06&hasta=2030-01-08`);
    const ids = citasParaRecordatorioRespuestaSchema.parse(r.json()).citas.map((c) => c.citaId);
    expect(ids).toEqual([citaId.antes, citaId.agendada, citaId.confirmada, citaId.despues]);
    expect(ids).not.toContain(citaId.ajena);
    const ajeno = citasParaRecordatorioRespuestaSchema.parse((await get(`tenantId=${OTRO}&desde=2030-01-07&hasta=2030-01-07`)).json());
    expect(ajeno.citas.map((c) => c.citaId)).toEqual([citaId.ajena]);
  });

  test('rango > 8 días, invertido, fechas o tenantId inválidos → 400', async () => {
    expect((await get(`tenantId=${T}&desde=2030-01-01&hasta=2030-01-08`)).statusCode).toBe(200); // 8 días exactos
    for (const q of [
      `tenantId=${T}&desde=2030-01-01&hasta=2030-01-09`,
      `tenantId=${T}&desde=2030-01-08&hasta=2030-01-07`,
      `tenantId=${T}&desde=2030-02-30&hasta=2030-02-30`,
      `tenantId=${T}&desde=2030-01-07`,
      `tenantId=no-es-uuid&desde=2030-01-07&hasta=2030-01-07`,
    ]) {
      const r = await get(q);
      expect(r.statusCode, q).toBe(400);
      expect(r.json().code).toBe('VALIDACION');
    }
  });

  test('tenant sin consultorio inicializado → 404', async () => {
    expect((await get(`tenantId=${SIN_CONSULTORIO}&desde=2030-01-07&hasta=2030-01-07`)).statusCode).toBe(404);
  });
});
