import { jetstream } from '@nats-io/jetstream';
import { CitaCancelada, CitaCreada, CitaReprogramada } from '@consultorio/contracts';
import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { iniciarConsumidor } from '../../src/consumidor.js';
import { generarToken } from '../../src/dominio/token.js';
import { iniciarNotificaciones, type Notificaciones } from './helpers.js';

let n: Notificaciones;
let consumidor: { stop(): Promise<void> };

beforeAll(async () => {
  n = await iniciarNotificaciones();
  n.dobles.consultorio = { ...n.dobles.consultorio, zonaHoraria: 'America/Tijuana' };
  consumidor = await iniciarConsumidor({ pool: n.appPool, nc: n.nc, identidad: n.puertos.identidad });
});
afterAll(async () => {
  await consumidor.stop();
  await n.stop();
});

const publicar = (e: { type: string }) => jetstream(n.nc).publish(`evt.${e.type}`, JSON.stringify(e));
const base = (t: string) => ({ tenantId: t, actorId: null, traceId: 'trace-prueba' });

async function esperar<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > fin) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const consultorios = (t: string) => withTenant(n.appPool, t, async (tx) => (await tx.query('SELECT * FROM consultorio')).rows);
const envios = (t: string) =>
  withTenant(n.appPool, t, async (tx) => (await tx.query('SELECT cita_id, fecha_cita::text AS fecha, canal, estado, token_hash FROM envio ORDER BY canal, fecha_cita')).rows);

async function insertarEnvio(t: string, citaId: string, fecha: string, estado: string, canal = 'correo'): Promise<string> {
  const { hash } = generarToken();
  await withTenant(n.appPool, t, (tx) =>
    tx.query(
      `INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, estado, token_hash, token_expira_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '30 days')`,
      [uuidv7(), t, citaId, fecha, canal, estado, hash],
    ),
  );
  return hash;
}

const cita = (citaId: string, inicio: string) => ({ citaId, medicoId: uuidv7(), inicio, fin: new Date(Date.parse(inicio) + 30 * 60_000).toISOString() });

/** Barrera: el consumidor procesa en orden, así que cuando ya se ve el efecto de este evento los anteriores terminaron. */
async function barrera(): Promise<void> {
  const t = uuidv7();
  await publicar(CitaCreada.create({ ...base(t), data: { ...cita(uuidv7(), '2031-01-01T18:00:00.000Z'), tipoCitaId: uuidv7(), estado: 'agendada', origen: 'recepcion', fueraDeHorario: false } }));
  await esperar(() => consultorios(t), (f) => f.length >= 1);
}

describe('consumidor de notificaciones', () => {
  test('cita.creada registra el consultorio con la zona de identidad, es idempotente y no crea envíos', async () => {
    const T = uuidv7();
    const e = CitaCreada.create({
      ...base(T),
      data: { ...cita(uuidv7(), '2031-02-03T18:00:00.000Z'), tipoCitaId: uuidv7(), estado: 'agendada', origen: 'recepcion', fueraDeHorario: false },
    });
    await publicar(e);
    await publicar(e);
    expect(await esperar(() => consultorios(T), (f) => f.length >= 1)).toEqual([{ tenant_id: T, zona_horaria: 'America/Tijuana' }]);
    expect(await envios(T)).toEqual([]);
  });

  test('Review Focus 1: reprogramar anula el envío de la fecha anterior (cualquier canal) y su token deja de encontrarse', async () => {
    const T = uuidv7();
    const C = uuidv7();
    // 2031-03-04T03:00Z = 2031-03-03 19:00 en Tijuana (PST): la fecha local anterior es 03, no la UTC.
    const hashCorreo = await insertarEnvio(T, C, '2031-03-03', 'enviado');
    await insertarEnvio(T, C, '2031-03-03', 'enviado', 'whatsapp_asistido');
    const hashOtraFecha = await insertarEnvio(T, C, '2031-03-10', 'aprobado');
    const hashOtraCita = await insertarEnvio(T, uuidv7(), '2031-03-03', 'aprobado');
    await publicar(
      CitaReprogramada.create({
        ...base(T),
        data: { ...cita(C, '2031-03-11T18:00:00.000Z'), anterior: { medicoId: uuidv7(), inicio: '2031-03-04T03:00:00.000Z', fin: '2031-03-04T03:30:00.000Z' } },
      }),
    );
    await esperar(() => envios(T), (f) => f.some((x) => x.estado === 'anulado'));
    await barrera();
    const despues = await envios(T);
    expect(despues.filter((f) => f.cita_id === C && f.fecha === '2031-03-03').map((f) => [f.canal, f.estado, f.token_hash])).toEqual([
      ['correo', 'anulado', null],
      ['whatsapp_asistido', 'anulado', null],
    ]);
    expect(despues.find((f) => f.fecha === '2031-03-10')).toMatchObject({ estado: 'aprobado', token_hash: hashOtraFecha });
    expect(despues.find((f) => f.cita_id !== C)).toMatchObject({ estado: 'aprobado', token_hash: hashOtraCita });
    // El token viejo ya no se encuentra.
    expect((await n.appPool.query('SELECT * FROM fn_envio_por_token($1)', [hashCorreo])).rows).toEqual([]);
  });

  test('cita.cancelada anula pendientes, aprobados y fallidos; lo enviado queda como está', async () => {
    const T = uuidv7();
    const C = uuidv7();
    await insertarEnvio(T, C, '2031-04-01', 'pendiente');
    await insertarEnvio(T, C, '2031-04-02', 'aprobado');
    await insertarEnvio(T, C, '2031-04-03', 'fallido');
    await insertarEnvio(T, C, '2031-04-04', 'enviado');
    await insertarEnvio(T, uuidv7(), '2031-04-01', 'pendiente');
    await publicar(CitaCancelada.create({ ...base(T), data: { ...cita(C, '2031-04-05T18:00:00.000Z'), origen: 'personal' } }));
    await esperar(() => envios(T), (f) => f.some((x) => x.estado === 'anulado'));
    await barrera();
    const filas = await envios(T);
    expect(filas.filter((f) => f.cita_id === C).map((f) => [f.fecha, f.estado, f.token_hash === null])).toEqual([
      ['2031-04-01', 'anulado', true],
      ['2031-04-02', 'anulado', true],
      ['2031-04-03', 'anulado', true],
      ['2031-04-04', 'enviado', false],
    ]);
    expect(filas.find((f) => f.cita_id !== C)?.estado).toBe('pendiente');
  });
});
