import { withTenant } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/server.js';
import { iniciarAgenda, type Agenda } from './helpers.js';

let ag: Agenda;
let app: FastifyInstance; // reloj fijo: lunes 2030-01-07 15:00Z (09:00 hora del consultorio)
const T = uuidv7();
const SIN_CONSULTORIO = uuidv7();
const dr = uuidv7();
const otroDr = uuidv7();
const drSinConsultorio = uuidv7();
const tipo = uuidv7();
const tipoOtro = uuidv7();
const tipoInactivo = uuidv7();
const tipoSinConsultorio = uuidv7();

// Lunes 09:00-23:00 local = 15:00Z-05:00Z. Cada prueba usa su propio hueco para no depender de las demás.
const hueco = (min: number) => new Date(Date.parse('2030-01-07T15:00:00Z') + min * 60_000).toISOString();
const CONTACTO = { nombre: 'Paciente Prueba', telefono: '5555555555', email: 'p@example.com' };

beforeAll(async () => {
  ag = await iniciarAgenda();
  app = await buildServer({ pool: ag.appPool, jwksUrl: ag.jwks.url, reloj: () => new Date('2030-01-07T15:00:00Z') });
  await app.ready();
  await withTenant(ag.appPool, T, (tx) => tx.query("INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, 'America/Mexico_City')", [T]));
  await ag.sembrarMedico(T, dr, 'Dra. Ana');
  await ag.sembrarMedico(T, otroDr, 'Dr. Beto');
  await ag.sembrarMedico(SIN_CONSULTORIO, drSinConsultorio, 'Dr. Huérfano');
  await withTenant(ag.appPool, T, async (tx) => {
    const t = 'INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min, activo) VALUES ($1, $2, $3, $4, $5, $6)';
    await tx.query(t, [tipo, T, dr, 'Consulta', 30, true]);
    await tx.query(t, [tipoOtro, T, otroDr, 'Consulta B', 30, true]);
    await tx.query(t, [tipoInactivo, T, dr, 'Vieja', 30, false]);
    for (const m of [dr, otroDr]) {
      await tx.query("INSERT INTO horario (id, tenant_id, medico_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, 1, '09:00', '23:00')", [uuidv7(), T, m]);
    }
  });
  await withTenant(ag.appPool, SIN_CONSULTORIO, (tx) =>
    tx.query("INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, 'Consulta', 30)", [tipoSinConsultorio, SIN_CONSULTORIO, drSinConsultorio]),
  );
});
afterAll(async () => {
  await app.close();
  await ag.stop();
});

interface Resp {
  status: number;
  body: Record<string, unknown>;
}
const llamar = async (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown): Promise<Resp> => {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: r.statusCode, body: JSON.parse(r.body) as Record<string, unknown> };
};
const recepcion = () => ag.tokenPara({ tid: T, rol: 'recepcion' });
const medicoToken = (sub: string) => ag.tokenPara({ tid: T, sub, rol: 'medico' });
const cuerpo = (min: number, extra: Record<string, unknown> = {}) => ({ medicoId: dr, tipoCitaId: tipo, inicio: hueco(min), contacto: CONTACTO, ...extra });
const crear = async (min: number, extra: Record<string, unknown> = {}, token?: string) => llamar('POST', '/citas', token ?? (await recepcion()), cuerpo(min, extra));
const idDe = (r: Resp) => r.body['id'] as string;
const ultimoEvento = async (type: string, citaId: string) => {
  const r = await ag.migrator.query<{ payload: { data: Record<string, unknown> } }>(
    "SELECT payload FROM outbox WHERE tenant_id = $1 AND type = $2 AND payload->'data'->>'citaId' = $3 ORDER BY creado_en DESC LIMIT 1",
    [T, type, citaId],
  );
  return r.rows[0]?.payload;
};
const estado = async (id: string, version: number, e: string, token?: string) => llamar('POST', `/citas/${id}/estado`, token ?? (await recepcion()), { version, estado: e });
const mover = async (id: string, version: number, extra: Record<string, unknown>, token?: string) =>
  llamar('PATCH', `/citas/${id}`, token ?? (await recepcion()), { version, ...extra });

describe('POST /citas', () => {
  test('crear cita en horario → 201 y outbox con cita.creada sin datos de contacto', async () => {
    const r = await crear(0);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ medicoId: dr, tipoCitaId: tipo, estado: 'agendada', fueraDeHorario: false, version: 1, inicio: hueco(0), fin: hueco(30) });
    expect(r.body['contacto']).toEqual(CONTACTO);
    const ev = await ultimoEvento('cita.creada', idDe(r));
    expect(ev).toBeDefined();
    expect(ev!.data).toEqual({ citaId: idDe(r), medicoId: dr, tipoCitaId: tipo, inicio: hueco(0), fin: hueco(30), estado: 'agendada', origen: 'recepcion', fueraDeHorario: false });
    expect(JSON.stringify(ev)).not.toMatch(/telefono|contacto|5555|Paciente|example\.com/);
    const fila = await withTenant(ag.appPool, T, (tx) => tx.query<{ origen: string }>('SELECT origen FROM cita WHERE id = $1', [idDe(r)]));
    expect(fila.rows[0]!.origen).toBe('recepcion');
  });

  test('fuera de horario sin bandera → 422 FUERA_DE_HORARIO; con bandera → 201 fueraDeHorario=true', async () => {
    const fuera = 24 * 60; // martes: el médico no atiende
    const sin = await crear(fuera);
    expect(sin.status).toBe(422);
    expect(sin.body['code']).toBe('FUERA_DE_HORARIO');
    const con = await crear(fuera, { fueraDeHorario: true });
    expect(con.status).toBe(201);
    expect(con.body['fueraDeHorario']).toBe(true);
  });

  test('sobre un bloqueo → 409 HORARIO_BLOQUEADO aun con fueraDeHorario', async () => {
    await withTenant(ag.appPool, T, (tx) =>
      tx.query('INSERT INTO bloqueo (id, tenant_id, medico_id, rango) VALUES ($1, $2, $3, tstzrange($4, $5))', [uuidv7(), T, dr, hueco(60), hueco(90)]),
    );
    for (const extra of [{}, { fueraDeHorario: true }]) {
      const r = await crear(75, extra);
      expect(r.status).toBe(409);
      expect(r.body['code']).toBe('HORARIO_BLOQUEADO');
    }
  });

  test('misma hora de otra cita viva → 409 HORARIO_OCUPADO; una cancelada libera el hueco', async () => {
    const a = await crear(100);
    expect(a.status).toBe(201);
    const b = await crear(100);
    expect(b.status).toBe(409);
    expect(b.body['code']).toBe('HORARIO_OCUPADO');
    expect((await estado(idDe(a), 1, 'cancelada')).status).toBe(200);
    expect((await crear(100)).status).toBe(201);
  });

  test('inicio en el pasado → 400 VALIDACION', async () => {
    const r = await llamar('POST', '/citas', await recepcion(), { ...cuerpo(0), inicio: '2030-01-07T14:00:00Z' });
    expect(r.status).toBe(400);
    expect(r.body['code']).toBe('VALIDACION');
  });

  test('tipo inactivo, tipo de otro médico o inexistente → 400 VALIDACION', async () => {
    for (const tipoCitaId of [tipoInactivo, tipoOtro, uuidv7()]) {
      const r = await crear(120, { tipoCitaId });
      expect(r.status).toBe(400);
      expect(r.body['code']).toBe('VALIDACION');
    }
  });

  test('cuerpo inválido → 400; médico inexistente → 404; médico sobre otro → 403; sin consultorio → 404', async () => {
    expect((await llamar('POST', '/citas', await recepcion(), { ...cuerpo(0), contacto: { nombre: '', telefono: 'x' } })).status).toBe(400);
    expect((await crear(0, { medicoId: uuidv7() })).status).toBe(404);
    expect((await crear(130, {}, await medicoToken(otroDr))).status).toBe(403);
    const t2 = await ag.tokenPara({ tid: SIN_CONSULTORIO, rol: 'recepcion' });
    const r = await llamar('POST', '/citas', t2, { medicoId: drSinConsultorio, tipoCitaId: tipoSinConsultorio, inicio: hueco(30), contacto: CONTACTO });
    expect(r.status).toBe(404);
    expect(r.body['message']).toBe('Consultorio no inicializado');
  });

  test('un médico crea citas en su propia agenda', async () => {
    expect((await crear(140, {}, await medicoToken(dr))).status).toBe(201);
  });
});

describe('PATCH /citas/:id (reprogramar)', () => {
  test('reprograma, sube la versión, vuelve a agendada y emite cita.reprogramada', async () => {
    const a = await crear(200);
    const id = idDe(a);
    const conf = await estado(id, 1, 'confirmada');
    expect(conf.body['version']).toBe(2);
    const r = await mover(id, 2, { inicio: hueco(210) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'agendada', version: 3, inicio: hueco(210), fin: hueco(240) });
    const ev = await ultimoEvento('cita.reprogramada', id);
    expect(ev!.data).toEqual({ citaId: id, medicoId: dr, inicio: hueco(210), fin: hueco(240), anterior: { medicoId: dr, inicio: hueco(200), fin: hueco(230) } });
    expect(JSON.stringify(ev)).not.toMatch(/telefono|contacto|5555|Paciente/);
  });

  test('puede encimarse con su propio horario anterior', async () => {
    const a = await crear(250);
    expect((await mover(idDe(a), 1, { inicio: hueco(260) })).status).toBe(200);
  });

  test('Review Focus 2: dos reprogramaciones con la misma versión → una 200, otra 409 CONFLICTO_VERSION', async () => {
    const id = idDe(await crear(300));
    const primera = await mover(id, 1, { inicio: hueco(310) });
    const segunda = await mover(id, 1, { inicio: hueco(320) });
    expect(primera.status).toBe(200);
    expect(segunda.status).toBe(409);
    expect(segunda.body['code']).toBe('CONFLICTO_VERSION');
    const final = await llamar('GET', `/citas/${id}`, await recepcion());
    expect(final.body).toMatchObject({ version: 2, inicio: hueco(310) });
    const n = await ag.migrator.query("SELECT 1 FROM outbox WHERE tenant_id = $1 AND type = 'cita.reprogramada' AND payload->'data'->>'citaId' = $2", [T, id]);
    expect(n.rowCount).toBe(1);
  });

  test('reprogramar una cita atendida → 409 CONFLICTO', async () => {
    const id = idDe(await crear(340));
    await estado(id, 1, 'atendida');
    const r = await mover(id, 2, { inicio: hueco(350) });
    expect(r.status).toBe(409);
    expect(r.body['code']).toBe('CONFLICTO');
  });

  test('sobre otra cita viva, un bloqueo, el pasado o fuera de horario se rechaza como en el alta', async () => {
    const x = idDe(await crear(380));
    await crear(420);
    expect((await mover(x, 1, { inicio: hueco(410) })).body['code']).toBe('HORARIO_OCUPADO');
    expect((await mover(x, 1, { inicio: hueco(75) })).body['code']).toBe('HORARIO_BLOQUEADO');
    const pasado = await mover(x, 1, { inicio: '2030-01-07T14:00:00Z' });
    expect(pasado.status).toBe(400);
    expect(pasado.body['code']).toBe('VALIDACION');
    const fuera = await mover(x, 1, { inicio: hueco(25 * 60) });
    expect(fuera.status).toBe(422);
    const conBandera = await mover(x, 1, { inicio: hueco(25 * 60), fueraDeHorario: true });
    expect(conBandera.body).toMatchObject({ fueraDeHorario: true, version: 2 });
  });

  test('cita inexistente → 404', async () => {
    expect((await mover(uuidv7(), 1, { inicio: hueco(10) })).status).toBe(404);
  });

  test('reprogramar a otro médico siendo médico → 403', async () => {
    const a = await crear(500, {}, await medicoToken(dr));
    const r = await mover(idDe(a), 1, { inicio: hueco(510), medicoId: otroDr, tipoCitaId: tipoOtro }, await medicoToken(dr));
    expect(r.status).toBe(403);
  });

  test('recepción cambia de médico: el tipo debe ser del destino (400) y con tipo del destino → 200', async () => {
    const id = idDe(await crear(540));
    const mal = await mover(id, 1, { inicio: hueco(540), medicoId: otroDr });
    expect(mal.status).toBe(400);
    expect(mal.body['code']).toBe('VALIDACION');
    const bien = await mover(id, 1, { inicio: hueco(540), medicoId: otroDr, tipoCitaId: tipoOtro });
    expect(bien.status).toBe(200);
    expect(bien.body).toMatchObject({ medicoId: otroDr, tipoCitaId: tipoOtro });
    expect((await ultimoEvento('cita.reprogramada', id))!.data).toMatchObject({ medicoId: otroDr, anterior: { medicoId: dr } });
  });
});

describe('POST /citas/:id/estado', () => {
  test('cancelar emite cita.cancelada; confirmar emite cita.estado_cambiado', async () => {
    const id = idDe(await crear(600));
    const conf = await estado(id, 1, 'confirmada');
    expect(conf.body).toMatchObject({ estado: 'confirmada', version: 2 });
    expect((await ultimoEvento('cita.estado_cambiado', id))!.data).toEqual({ citaId: id, medicoId: dr, de: 'agendada', a: 'confirmada' });
    const can = await estado(id, 2, 'cancelada');
    expect(can.body).toMatchObject({ estado: 'cancelada', version: 3 });
    const ev = await ultimoEvento('cita.cancelada', id);
    expect(ev!.data).toMatchObject({ citaId: id, medicoId: dr });
    expect(JSON.stringify(ev)).not.toMatch(/telefono|contacto|5555/);
  });

  test('transición cancelada→confirmada → 409 CONFLICTO; versión vieja → 409 CONFLICTO_VERSION; inexistente → 404', async () => {
    const id = idDe(await crear(640));
    await estado(id, 1, 'cancelada');
    const r = await estado(id, 2, 'confirmada');
    expect(r.status).toBe(409);
    expect(r.body['code']).toBe('CONFLICTO');
    expect((await estado(id, 1, 'confirmada')).body['code']).toBe('CONFLICTO_VERSION');
    expect((await estado(uuidv7(), 1, 'confirmada')).status).toBe(404);
  });

  test('un médico no cambia el estado de la cita de otro médico → 403', async () => {
    const id = idDe(await crear(680));
    expect((await estado(id, 1, 'confirmada', await medicoToken(otroDr))).status).toBe(403);
  });
});

describe('GET /citas', () => {
  const DIA = 'desde=2030-01-07T00:00:00Z&hasta=2030-01-08T00:00:00Z';
  beforeAll(async () => {
    expect((await crear(0, { medicoId: otroDr, tipoCitaId: tipoOtro })).status).toBe(201);
  });
  type Lista = { citas: { inicio: string; medicoId: string; estado: string }[] };
  const listar = async (url: string, token: string) => {
    const r = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    return { status: r.statusCode, body: JSON.parse(r.body) as Lista };
  };

  test('lista por rango ordenada por inicio e incluye canceladas', async () => {
    const r = await listar(`/citas?${DIA}&medicoId=${dr}`, await recepcion());
    expect(r.status).toBe(200);
    const inicios = r.body.citas.map((c) => c.inicio);
    expect(inicios.length).toBeGreaterThan(3);
    expect(inicios).toEqual([...inicios].sort());
    expect(r.body.citas.every((c) => c.medicoId === dr)).toBe(true);
    expect(r.body.citas.some((c) => c.estado === 'cancelada')).toBe(true);
  });

  test('sin medicoId recepción ve a todos; el rango acota', async () => {
    const todos = await listar(`/citas?${DIA}`, await recepcion());
    expect(new Set(todos.body.citas.map((c) => c.medicoId))).toEqual(new Set([dr, otroDr]));
    const vacio = await listar('/citas?desde=2031-01-01T00:00:00Z&hasta=2031-01-02T00:00:00Z', await recepcion());
    expect(vacio.body.citas).toEqual([]);
  });

  test('un médico solo obtiene las suyas', async () => {
    const r = await listar(`/citas?${DIA}`, await medicoToken(otroDr));
    expect(r.body.citas.length).toBeGreaterThan(0);
    expect(r.body.citas.every((c) => c.medicoId === otroDr)).toBe(true);
  });

  test('Review Focus 5: médico lista citas con medicoId de otro → 403', async () => {
    expect((await listar(`/citas?${DIA}&medicoId=${dr}`, await medicoToken(otroDr))).status).toBe(403);
  });

  test('GET /citas con rango de 40 días → 400; rango invertido o sin parámetros → 400; 31 días → 200', async () => {
    const token = await recepcion();
    expect((await listar('/citas?desde=2030-01-01T00:00:00Z&hasta=2030-02-10T00:00:00Z', token)).status).toBe(400);
    expect((await listar('/citas?desde=2030-01-08T00:00:00Z&hasta=2030-01-07T00:00:00Z', token)).status).toBe(400);
    expect((await listar('/citas', token)).status).toBe(400);
    expect((await listar('/citas?desde=2030-01-01T00:00:00Z&hasta=2030-02-01T00:00:00Z', token)).status).toBe(200);
  });
});

describe('GET /citas/:id', () => {
  test('devuelve la cita; inexistente → 404; médico ajeno → 403', async () => {
    const id = idDe(await crear(720));
    const r = await llamar('GET', `/citas/${id}`, await recepcion());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id, contacto: CONTACTO });
    expect((await llamar('GET', `/citas/${uuidv7()}`, await recepcion())).status).toBe(404);
    expect((await llamar('GET', `/citas/${id}`, await medicoToken(otroDr))).status).toBe(403);
  });

  test('aislamiento: otro tenant no ve la cita → 404', async () => {
    const id = idDe(await crear(760));
    const r = await llamar('GET', `/citas/${id}`, await ag.tokenPara({ tid: SIN_CONSULTORIO, rol: 'recepcion' }));
    expect(r.status).toBe(404);
  });
});

describe('médico inactivo (spec §3.2: sus citas existentes se conservan)', () => {
  const drInactivo = uuidv7();
  const tipoInactivoDr = uuidv7();
  const RANGO = 'desde=2030-01-07T00:00:00Z&hasta=2030-01-09T00:00:00Z';
  const admin = () => ag.tokenPara({ tid: T, rol: 'medico', admin: true });
  let aVer: string;
  let aCancelar: string;
  let aReasignar: string;

  beforeAll(async () => {
    await ag.sembrarMedico(T, drInactivo, 'Dra. Inactiva');
    await withTenant(ag.appPool, T, async (tx) => {
      await tx.query('INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, $4, 30)', [tipoInactivoDr, T, drInactivo, 'Consulta I']);
      await tx.query("INSERT INTO horario (id, tenant_id, medico_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, 1, '09:00', '23:00')", [uuidv7(), T, drInactivo]);
    });
    const deInactivo = { medicoId: drInactivo, tipoCitaId: tipoInactivoDr };
    const creadas = await Promise.all([crear(600, deInactivo), crear(650, deInactivo), crear(700, deInactivo)]);
    expect(creadas.map((r) => r.status)).toEqual([201, 201, 201]);
    [aVer, aCancelar, aReasignar] = creadas.map(idDe) as [string, string, string];
    // Identidad le quitó el rol de médico: agenda lo marca inactivo (miembro.actualizado).
    await withTenant(ag.appPool, T, (tx) => tx.query('UPDATE medico SET activo = false WHERE tenant_id = $1 AND usuario_id = $2', [T, drInactivo]));
  });

  test('recepción y admin siguen viendo sus citas (detalle y listado por médico)', async () => {
    for (const token of [await recepcion(), await admin()]) {
      expect((await llamar('GET', `/citas/${aVer}`, token)).status).toBe(200);
      const r = await app.inject({ method: 'GET', url: `/citas?${RANGO}&medicoId=${drInactivo}`, headers: { authorization: `Bearer ${token}` } });
      expect(r.statusCode).toBe(200);
      expect((JSON.parse(r.body) as { citas: { id: string }[] }).citas.map((c) => c.id)).toEqual(expect.arrayContaining([aVer, aCancelar, aReasignar]));
    }
  });

  test('recepción cancela su cita futura', async () => {
    const r = await estado(aCancelar, 1, 'cancelada');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'cancelada', version: 2 });
  });

  test('admin reasigna su cita a un médico activo', async () => {
    const r = await mover(aReasignar, 1, { inicio: hueco(700), medicoId: otroDr, tipoCitaId: tipoOtro }, await admin());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ medicoId: otroDr, tipoCitaId: tipoOtro, version: 2 });
    expect((await ultimoEvento('cita.reprogramada', aReasignar))!.data).toMatchObject({ medicoId: otroDr, anterior: { medicoId: drInactivo } });
  });

  test('no se le pueden crear citas nuevas ni moverle citas: 404', async () => {
    const nueva = await crear(750, { medicoId: drInactivo, tipoCitaId: tipoInactivoDr });
    expect(nueva.status).toBe(404);
    expect(nueva.body['code']).toBe('NO_ENCONTRADO');
    // Como destino de una reprogramación, también dentro de su propia agenda.
    expect((await mover(aVer, 1, { inicio: hueco(780) })).status).toBe(404);
    const deOtro = idDe(await crear(790, { medicoId: otroDr, tipoCitaId: tipoOtro }));
    expect((await mover(deOtro, 1, { inicio: hueco(790), medicoId: drInactivo, tipoCitaId: tipoInactivoDr })).status).toBe(404);
  });

  test('un médico sin admin sigue sin poder tocar la cita de otro aunque esté inactivo → 403', async () => {
    expect((await llamar('GET', `/citas/${aVer}`, await medicoToken(otroDr))).status).toBe(403);
  });
});
