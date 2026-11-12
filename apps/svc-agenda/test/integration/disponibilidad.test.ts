import { withTenant } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/server.js';
import { iniciarAgenda, type Agenda } from './helpers.js';

let ag: Agenda;
let app: FastifyInstance; // reloj fijo: lunes 2030-01-07 15:45Z (09:45 hora del consultorio)
const T = uuidv7();
const SIN_CONSULTORIO = uuidv7();
const dr = uuidv7();
const otroDr = uuidv7();
const drSinConsultorio = uuidv7();
const tipo = uuidv7();
const FECHA = '2030-01-07';

const INSERT_CITA = `INSERT INTO cita (id, tenant_id, medico_id, tipo_cita_id, rango, estado, contacto_nombre, contacto_telefono, origen, creada_por)
  VALUES ($1, $2, $3, $4, tstzrange($5, $6), $7, 'P', '5555555555', 'recepcion', $8)`;

beforeAll(async () => {
  ag = await iniciarAgenda();
  app = await buildServer({ pool: ag.appPool, jwksUrl: ag.jwks.url, reloj: () => new Date('2030-01-07T15:45:00Z') });
  await app.ready();
  await withTenant(ag.appPool, T, (tx) => tx.query("INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, 'America/Mexico_City')", [T]));
  await ag.sembrarMedico(T, dr, 'Dra. Ana');
  await ag.sembrarMedico(T, otroDr, 'Dr. Beto');
  await ag.sembrarMedico(SIN_CONSULTORIO, drSinConsultorio, 'Dr. Huérfano');
  await withTenant(ag.appPool, T, async (tx) => {
    await tx.query("INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, 'Consulta', 30)", [tipo, T, dr]);
    // Lunes 09:00–12:00 local = 15:00–18:00Z
    await tx.query("INSERT INTO horario (id, tenant_id, medico_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, 1, '09:00', '12:00')", [uuidv7(), T, dr]);
    await tx.query(INSERT_CITA, [uuidv7(), T, dr, tipo, '2030-01-07T17:00:00Z', '2030-01-07T17:30:00Z', 'agendada', uuidv7()]);
    // Cita cancelada: no ocupa.
    await tx.query(INSERT_CITA, [uuidv7(), T, dr, tipo, '2030-01-07T17:30:00Z', '2030-01-07T18:00:00Z', 'cancelada', uuidv7()]);
    await tx.query("INSERT INTO bloqueo (id, tenant_id, medico_id, rango) VALUES ($1, $2, $3, tstzrange('2030-01-07T16:00:00Z', '2030-01-07T16:30:00Z'))", [uuidv7(), T, dr]);
  });
});
afterAll(async () => {
  await app.close();
  await ag.stop();
});

const get = async (a: FastifyInstance, token: string, url: string) => {
  const r = await a.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: JSON.parse(r.body) as { code: string; message: string; huecos: string[] } };
};

describe('GET /medicos/:id/disponibilidad', () => {
  test('excluye citas y bloqueos y respeta el reloj inyectado', async () => {
    const token = await ag.tokenPara({ tid: T, rol: 'recepcion' });
    const r = await get(app, token, `/medicos/${dr}/disponibilidad?fecha=${FECHA}&tipoCitaId=${tipo}`);
    expect(r.status).toBe(200);
    // 15:00 y 15:30 ya pasaron (ahora = 15:45Z); 16:00 bloqueado; 17:00 con cita; 17:30 libre (la cita cancelada no ocupa).
    expect(r.body).toEqual({
      fecha: FECHA,
      tipoCitaId: tipo,
      huecos: ['2030-01-07T16:30:00.000Z', '2030-01-07T17:30:00.000Z'],
    });
  });

  test('con un reloj anterior al día aparecen también los huecos tempranos', async () => {
    const token = await ag.tokenPara({ tid: T, rol: 'recepcion' });
    const r = await get(ag.app, token, `/medicos/${dr}/disponibilidad?fecha=${FECHA}&tipoCitaId=${tipo}`);
    expect(r.body.huecos).toEqual(['2030-01-07T15:00:00.000Z', '2030-01-07T15:30:00.000Z', '2030-01-07T16:30:00.000Z', '2030-01-07T17:30:00.000Z']);
  });

  test('Review Focus 5: médico pide disponibilidad de otro médico → 403', async () => {
    const token = await ag.tokenPara({ tid: T, sub: otroDr, rol: 'medico' });
    const r = await get(app, token, `/medicos/${dr}/disponibilidad?fecha=${FECHA}&tipoCitaId=${tipo}`);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PROHIBIDO');
  });

  test('el propio médico sí puede consultar la suya', async () => {
    const token = await ag.tokenPara({ tid: T, sub: dr, rol: 'medico' });
    expect((await get(app, token, `/medicos/${dr}/disponibilidad?fecha=${FECHA}&tipoCitaId=${tipo}`)).status).toBe(200);
  });

  test('parámetros inválidos → 400; tipo de cita inexistente o de otro médico → 404', async () => {
    const token = await ag.tokenPara({ tid: T, rol: 'recepcion' });
    expect((await get(app, token, `/medicos/${dr}/disponibilidad?fecha=2030-13-45&tipoCitaId=${tipo}`)).status).toBe(400);
    expect((await get(app, token, `/medicos/${dr}/disponibilidad?fecha=${FECHA}`)).status).toBe(400);
    expect((await get(app, token, `/medicos/${dr}/disponibilidad?fecha=${FECHA}&tipoCitaId=${uuidv7()}`)).status).toBe(404);
    expect((await get(app, token, `/medicos/${otroDr}/disponibilidad?fecha=${FECHA}&tipoCitaId=${tipo}`)).status).toBe(404);
  });

  test('consultorio no inicializado → 404 NO_ENCONTRADO', async () => {
    const token = await ag.tokenPara({ tid: SIN_CONSULTORIO, rol: 'recepcion' });
    const r = await get(app, token, `/medicos/${drSinConsultorio}/disponibilidad?fecha=${FECHA}&tipoCitaId=${uuidv7()}`);
    expect(r.status).toBe(404);
    expect(r.body.message).toBe('Consultorio no inicializado');
  });
});
