import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { iniciarAgenda, type Agenda } from './helpers.js';

let ag: Agenda;
const T = uuidv7();
const T2 = uuidv7();
const dr = uuidv7();
const otroDr = uuidv7();
const inactivo = uuidv7();
const ajeno = uuidv7();

beforeAll(async () => {
  ag = await iniciarAgenda();
  for (const t of [T, T2]) {
    await withTenant(ag.appPool, t, (tx) => tx.query("INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, 'America/Mexico_City')", [t]));
  }
  await ag.sembrarMedico(T, dr, 'Dra. Ana');
  await ag.sembrarMedico(T, otroDr, 'Dr. Beto');
  await ag.sembrarMedico(T, inactivo, 'Dr. Inactivo');
  await ag.sembrarMedico(T2, ajeno, 'Dr. Ajeno');
  await withTenant(ag.appPool, T, (tx) => tx.query('UPDATE medico SET activo = false WHERE usuario_id = $1', [inactivo]));
});
afterAll(async () => {
  await ag.stop();
});

const recepcion = () => ag.tokenPara({ tid: T, rol: 'recepcion' });
const comoMedico = (sub: string) => ag.tokenPara({ tid: T, sub, rol: 'medico' });

/** Forma laxa de las respuestas: cada prueba lee solo los campos que le interesan. */
interface Cuerpo {
  code: string;
  id: string;
  medicos: { usuarioId: string; nombre: string }[];
  tiposCita: { id: string; nombre: string }[];
  bloques: unknown[];
  bloqueos: { id: string }[];
  [campo: string]: unknown;
}

async function pedir(token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<{ status: number; body: Cuerpo }> {
  const r = await ag.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: r.statusCode, body: (r.body ? JSON.parse(r.body) : {}) as Cuerpo };
}

describe('médicos', () => {
  test('recepción ve a todos los activos; un médico solo a sí mismo', async () => {
    const r = await pedir(await recepcion(), 'GET', '/medicos');
    expect(r.status).toBe(200);
    expect(r.body.medicos.map((m) => m.usuarioId).sort()).toEqual([dr, otroDr].sort());
    const m = await pedir(await comoMedico(dr), 'GET', '/medicos');
    expect(m.body.medicos).toEqual([{ usuarioId: dr, nombre: 'Dra. Ana' }]);
  });
});

describe('tipos de cita', () => {
  test('recepción crea tipo de cita para un médico; médico ve solo los suyos', async () => {
    const c = await pedir(await recepcion(), 'POST', `/medicos/${dr}/tipos-cita`, { nombre: 'Consulta', duracionMin: 30 });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ medicoId: dr, nombre: 'Consulta', duracionMin: 30, activo: true });
    await pedir(await recepcion(), 'POST', `/medicos/${otroDr}/tipos-cita`, { nombre: 'Revisión', duracionMin: 15 });

    const propios = await pedir(await comoMedico(dr), 'GET', `/medicos/${dr}/tipos-cita`);
    expect(propios.status).toBe(200);
    expect(propios.body.tiposCita.map((t) => t.nombre)).toEqual(['Consulta']);
    const ajenos = await pedir(await comoMedico(dr), 'GET', `/medicos/${otroDr}/tipos-cita`);
    expect(ajenos.status).toBe(403);
    expect(ajenos.body.code).toBe('PROHIBIDO');
  });

  test('tipo de cita con duración 3 → 400; nombre duplicado activo → 409', async () => {
    const mala = await pedir(await recepcion(), 'POST', `/medicos/${dr}/tipos-cita`, { nombre: 'Corta', duracionMin: 3 });
    expect(mala.status).toBe(400);
    expect(mala.body.code).toBe('VALIDACION');
    const dup = await pedir(await recepcion(), 'POST', `/medicos/${dr}/tipos-cita`, { nombre: 'consulta', duracionMin: 20 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CONFLICTO');
  });

  test('PATCH edita; inactivos solo con ?todos=1; el nombre se libera al desactivar', async () => {
    const c = await pedir(await recepcion(), 'POST', `/medicos/${dr}/tipos-cita`, { nombre: 'Temporal', duracionMin: 45 });
    const id = c.body.id;
    const p = await pedir(await recepcion(), 'PATCH', `/medicos/${dr}/tipos-cita/${id}`, { duracionMin: 60, activo: false });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ id, duracionMin: 60, activo: false });
    const activos = await pedir(await recepcion(), 'GET', `/medicos/${dr}/tipos-cita`);
    expect(activos.body.tiposCita.map((t) => t.id)).not.toContain(id);
    const todos = await pedir(await recepcion(), 'GET', `/medicos/${dr}/tipos-cita?todos=1`);
    expect(todos.body.tiposCita.map((t) => t.id)).toContain(id);
    const otra = await pedir(await recepcion(), 'POST', `/medicos/${dr}/tipos-cita`, { nombre: 'Temporal', duracionMin: 45 });
    expect(otra.status).toBe(201);
    // Reactivar el desactivado choca con el activo del mismo nombre.
    const choque = await pedir(await recepcion(), 'PATCH', `/medicos/${dr}/tipos-cita/${id}`, { activo: true });
    expect(choque.status).toBe(409);
    const inexistente = await pedir(await recepcion(), 'PATCH', `/medicos/${dr}/tipos-cita/${uuidv7()}`, { activo: true });
    expect(inexistente.status).toBe(404);
  });
});

describe('horario', () => {
  const semana = {
    bloques: [
      { diaSemana: 1, horaInicio: '09:00', horaFin: '14:00' },
      { diaSemana: 1, horaInicio: '16:00', horaFin: '19:00' },
    ],
  };

  test('PUT horario reemplaza la semana; bloques encimados → 400 y la semana anterior queda intacta', async () => {
    const put = await pedir(await recepcion(), 'PUT', `/medicos/${otroDr}/horario`, semana);
    expect(put.status).toBe(200);
    expect(put.body.bloques).toHaveLength(2);

    const nueva = { bloques: [{ diaSemana: 2, horaInicio: '08:00', horaFin: '12:00' }] };
    expect((await pedir(await recepcion(), 'PUT', `/medicos/${otroDr}/horario`, nueva)).status).toBe(200);
    const get = await pedir(await recepcion(), 'GET', `/medicos/${otroDr}/horario`);
    expect(get.body.bloques).toEqual(nueva.bloques);

    const encimados = {
      bloques: [
        { diaSemana: 3, horaInicio: '08:00', horaFin: '12:00' },
        { diaSemana: 3, horaInicio: '11:00', horaFin: '13:00' },
      ],
    };
    const mal = await pedir(await recepcion(), 'PUT', `/medicos/${otroDr}/horario`, encimados);
    expect(mal.status).toBe(400);
    expect(mal.body.code).toBe('VALIDACION');
    expect((await pedir(await recepcion(), 'GET', `/medicos/${otroDr}/horario`)).body.bloques).toEqual(nueva.bloques);
  });

  test('un PUT rechazado deja intacta la semana anterior', async () => {
    const base = { bloques: [{ diaSemana: 5, horaInicio: '08:00', horaFin: '12:00' }] };
    expect((await pedir(await recepcion(), 'PUT', `/medicos/${dr}/horario`, base)).status).toBe(200);
    const dup = {
      bloques: [
        { diaSemana: 4, horaInicio: '08:00', horaFin: '12:00' },
        { diaSemana: 4, horaInicio: '08:00', horaFin: '12:00' },
      ],
    };
    const r = await pedir(await recepcion(), 'PUT', `/medicos/${dr}/horario`, dup);
    expect(r.status).toBe(400);
    expect((await pedir(await recepcion(), 'GET', `/medicos/${dr}/horario`)).body.bloques).toEqual(base.bloques);
  });

  test('un médico no edita el horario de otro', async () => {
    const r = await pedir(await comoMedico(dr), 'PUT', `/medicos/${otroDr}/horario`, semana);
    expect(r.status).toBe(403);
  });
});

describe('bloqueos', () => {
  test('crear, listar por rango y borrar', async () => {
    const c = await pedir(await recepcion(), 'POST', `/medicos/${dr}/bloqueos`, { inicio: '2030-02-04T15:00:00Z', fin: '2030-02-04T17:00:00Z', motivo: 'Congreso' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ medicoId: dr, inicio: '2030-02-04T15:00:00.000Z', fin: '2030-02-04T17:00:00.000Z', motivo: 'Congreso' });
    const id = c.body.id as string;

    const dentro = await pedir(await recepcion(), 'GET', `/medicos/${dr}/bloqueos?desde=2030-02-04T00:00:00Z&hasta=2030-02-05T00:00:00Z`);
    expect(dentro.body.bloqueos.map((b) => b.id)).toEqual([id]);
    const fuera = await pedir(await recepcion(), 'GET', `/medicos/${dr}/bloqueos?desde=2030-03-01T00:00:00Z&hasta=2030-03-02T00:00:00Z`);
    expect(fuera.body.bloqueos).toEqual([]);

    expect((await pedir(await recepcion(), 'DELETE', `/medicos/${dr}/bloqueos/${id}`)).status).toBe(204);
    expect((await pedir(await recepcion(), 'DELETE', `/medicos/${dr}/bloqueos/${id}`)).status).toBe(404);
  });

  test('bloqueo con fin <= inicio → 400', async () => {
    const r = await pedir(await recepcion(), 'POST', `/medicos/${dr}/bloqueos`, { inicio: '2030-02-04T15:00:00Z', fin: '2030-02-04T15:00:00Z' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDACION');
  });
});

describe('acceso', () => {
  test('médico de otro tenant → 404; médico inactivo → 404', async () => {
    const otro = await pedir(await recepcion(), 'GET', `/medicos/${ajeno}/horario`);
    expect(otro.status).toBe(404);
    expect(otro.body.code).toBe('NO_ENCONTRADO');
    const inac = await pedir(await recepcion(), 'GET', `/medicos/${inactivo}/horario`);
    expect(inac.status).toBe(404);
    expect((await pedir(await recepcion(), 'POST', `/medicos/${inactivo}/tipos-cita`, { nombre: 'X', duracionMin: 30 })).status).toBe(404);
  });

  test('sin token → 401', async () => {
    const r = await ag.app.inject({ method: 'GET', url: '/medicos' });
    expect(r.statusCode).toBe(401);
  });
});
