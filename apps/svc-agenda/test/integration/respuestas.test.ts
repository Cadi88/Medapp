import { jetstream } from '@nats-io/jetstream';
import { CitaRespuestaPaciente } from '@consultorio/contracts';
import { withTenant } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { iniciarConsumidor } from '../../src/consumidor.js';
import { buildServer } from '../../src/server.js';
import { iniciarAgenda, TOKEN_INTERNO_PRUEBA, type Agenda } from './helpers.js';

let ag: Agenda;
let app: FastifyInstance; // reloj fijo: lunes 2030-01-07 15:00Z (09:00 hora del consultorio)
let consumidor: { stop(): Promise<void> };
const T = uuidv7();
const dr = uuidv7();
const tipo = uuidv7();
const recepcionUsuario = uuidv7();

const hueco = (min: number) => new Date(Date.parse('2030-01-07T15:00:00Z') + min * 60_000).toISOString();
const CONTACTO = { nombre: 'Paciente Prueba', telefono: '5555555555', email: 'p@example.com' };

beforeAll(async () => {
  ag = await iniciarAgenda();
  consumidor = await iniciarConsumidor({ pool: ag.appPool, nc: ag.nc });
  app = await buildServer({ pool: ag.appPool, jwksUrl: ag.jwks.url, tokenInterno: TOKEN_INTERNO_PRUEBA, reloj: () => new Date('2030-01-07T15:00:00Z') });
  await app.ready();
  await withTenant(ag.appPool, T, (tx) => tx.query("INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, 'America/Mexico_City')", [T]));
  await ag.sembrarMedico(T, dr, 'Dra. Ana');
  await withTenant(ag.appPool, T, async (tx) => {
    await tx.query('INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, $4, 30)', [tipo, T, dr, 'Consulta']);
    await tx.query("INSERT INTO horario (id, tenant_id, medico_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, 1, '09:00', '23:00')", [uuidv7(), T, dr]);
  });
});
afterAll(async () => {
  await consumidor.stop();
  await app.close();
  await ag.stop();
});

async function crearCita(min: number): Promise<{ id: string; inicio: string }> {
  const token = await ag.tokenPara({ tid: T, rol: 'recepcion' });
  const r = await app.inject({
    method: 'POST',
    url: '/citas',
    headers: { authorization: `Bearer ${token}` },
    payload: { medicoId: dr, tipoCitaId: tipo, inicio: hueco(min), contacto: CONTACTO },
  });
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body) as { id: string; inicio: string };
}

const evento = (c: { id: string; inicio: string }, respuesta: 'confirma' | 'cancela' | 'pide_cambio', o: { actorId?: string | null; inicioCita?: string } = {}) =>
  CitaRespuestaPaciente.create({
    tenantId: T,
    actorId: o.actorId ?? null,
    traceId: 'trace-respuesta',
    data: { citaId: c.id, inicioCita: o.inicioCita ?? c.inicio, respuesta, canal: 'correo', origen: o.actorId ? 'recepcion' : 'paciente' },
  });
const publicar = (e: { type: string }) => jetstream(ag.nc).publish(`evt.${e.type}`, JSON.stringify(e));

async function esperar<V>(fn: () => Promise<V>, ok: (v: V) => boolean, ms = 20_000): Promise<V> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > fin) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface FilaCita {
  estado: string;
  version: number;
  pide_cambio: boolean;
}
// `cita` tiene RLS forzada: se lee y escribe con el rol de la aplicación dentro del tenant.
const fila = (id: string) => withTenant(ag.appPool, T, async (tx) => (await tx.query<FilaCita>('SELECT estado, version, pide_cambio FROM cita WHERE id = $1', [id])).rows[0]!);
const fijarEstado = (id: string, estado: string) => withTenant(ag.appPool, T, (tx) => tx.query('UPDATE cita SET estado = $2 WHERE id = $1', [id, estado]));
const esperarVersion = (id: string, v: number) => esperar(() => fila(id), (f) => f.version >= v);
const eventos = async (type: string, citaId: string) =>
  (
    await ag.migrator.query<{ payload: { actor_id: string | null; trace_id: string; data: Record<string, unknown> } }>(
      "SELECT payload FROM outbox WHERE tenant_id = $1 AND type = $2 AND payload->'data'->>'citaId' = $3 ORDER BY creado_en",
      [T, type, citaId],
    )
  ).rows.map((r) => r.payload);

describe('respuestas del paciente', () => {
  test('confirma: agendada pasa a confirmada y emite cita.estado_cambiado con origen paciente', async () => {
    const c = await crearCita(0);
    await publicar(evento(c, 'confirma'));
    expect(await esperarVersion(c.id, 2)).toMatchObject({ estado: 'confirmada', version: 2, pide_cambio: false });
    const [ev] = await eventos('cita.estado_cambiado', c.id);
    expect(ev!.data).toEqual({ citaId: c.id, medicoId: dr, de: 'agendada', a: 'confirmada', origen: 'paciente' });
    expect(ev!.actor_id).toBeNull();
    expect(ev!.trace_id).toBe('trace-respuesta');
  });

  test('respuesta cancela: la cita queda cancelada, el hueco se libera y se emite cita.cancelada con origen paciente', async () => {
    const c = await crearCita(40);
    await publicar(evento(c, 'cancela'));
    expect(await esperarVersion(c.id, 2)).toMatchObject({ estado: 'cancelada', version: 2 });
    const [ev] = await eventos('cita.cancelada', c.id);
    expect(ev!.data).toMatchObject({ citaId: c.id, medicoId: dr, origen: 'paciente' });
    expect(JSON.stringify(ev)).not.toMatch(/telefono|contacto|5555|p@example/);
    // El hueco quedó libre: otra cita puede ocuparlo.
    expect((await crearCita(40)).id).not.toBe(c.id);
  });

  test('pide_cambio: pideCambio true, version+1, cita.estado_cambiado con pideCambio y el mismo estado', async () => {
    const c = await crearCita(80);
    await publicar(evento(c, 'pide_cambio'));
    expect(await esperarVersion(c.id, 2)).toMatchObject({ estado: 'agendada', version: 2, pide_cambio: true });
    const [ev] = await eventos('cita.estado_cambiado', c.id);
    expect(ev!.data).toEqual({ citaId: c.id, medicoId: dr, de: 'agendada', a: 'agendada', origen: 'paciente', pideCambio: true });
    const token = await ag.tokenPara({ tid: T });
    const api = await app.inject({ method: 'GET', url: `/citas/${c.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(api.body)).toMatchObject({ pideCambio: true, version: 2 });
  });

  test('el sobre emitido copia el actorId de recepción y origen recepcion', async () => {
    const c = await crearCita(120);
    await publicar(evento(c, 'confirma', { actorId: recepcionUsuario }));
    await esperarVersion(c.id, 2);
    const [ev] = await eventos('cita.estado_cambiado', c.id);
    expect(ev!.actor_id).toBe(recepcionUsuario);
    expect(ev!.data).toMatchObject({ origen: 'recepcion' });
  });

  test('reentrega del mismo evento no aplica dos veces (inbox)', async () => {
    const c = await crearCita(160);
    const e = evento(c, 'pide_cambio');
    await publicar(e);
    await publicar(e);
    await esperarVersion(c.id, 2);
    // Barrera: una respuesta posterior sobre otra cita ya procesada implica que el duplicado también.
    const barrera = await crearCita(200);
    await publicar(evento(barrera, 'confirma'));
    await esperarVersion(barrera.id, 2);
    expect((await fila(c.id)).version).toBe(2);
    expect(await eventos('cita.estado_cambiado', c.id)).toHaveLength(1);
  });

  test('ignora: reprogramada, estado final, sin efecto y cita inexistente no escriben nada', async () => {
    const reprogramada = await crearCita(240);
    const final = await crearCita(280);
    const confirmada = await crearCita(320);
    await fijarEstado(final.id, 'atendida');
    await fijarEstado(confirmada.id, 'confirmada');
    await publicar(evento(reprogramada, 'cancela', { inicioCita: hueco(1000) }));
    await publicar(evento(final, 'cancela'));
    await publicar(evento(confirmada, 'confirma'));
    await publicar(evento({ id: uuidv7(), inicio: hueco(0) }, 'cancela'));
    const barrera = await crearCita(360);
    await publicar(evento(barrera, 'confirma'));
    await esperarVersion(barrera.id, 2);
    expect(await fila(reprogramada.id)).toMatchObject({ estado: 'agendada', version: 1 });
    expect(await fila(final.id)).toMatchObject({ estado: 'atendida', version: 1 });
    expect(await fila(confirmada.id)).toMatchObject({ estado: 'confirmada', version: 1 });
    for (const id of [reprogramada.id, final.id, confirmada.id]) {
      expect(await eventos('cita.cancelada', id)).toHaveLength(0);
      expect(await eventos('cita.estado_cambiado', id)).toHaveLength(0);
    }
  });

  test('reprogramar limpia pideCambio', async () => {
    const c = await crearCita(400);
    await publicar(evento(c, 'pide_cambio'));
    await esperarVersion(c.id, 2);
    const token = await ag.tokenPara({ tid: T });
    const r = await app.inject({
      method: 'PATCH',
      url: `/citas/${c.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { version: 2, inicio: hueco(440) },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ pideCambio: false, version: 3 });
    expect((await fila(c.id)).pide_cambio).toBe(false);
  });

  test('la ruta interna devuelve el pideCambio real', async () => {
    const c = await crearCita(480);
    await publicar(evento(c, 'pide_cambio'));
    await esperarVersion(c.id, 2);
    const r = await app.inject({
      method: 'GET',
      url: `/interno/citas-para-recordatorio?tenantId=${T}&desde=2030-01-07&hasta=2030-01-07`,
      headers: { 'x-token-interno': TOKEN_INTERNO_PRUEBA },
    });
    const citas = (JSON.parse(r.body) as { citas: { citaId: string; pideCambio: boolean }[] }).citas;
    expect(citas.find((x) => x.citaId === c.id)?.pideCambio).toBe(true);
    expect(citas.find((x) => x.citaId !== c.id)?.pideCambio).toBe(false);
  });
});
