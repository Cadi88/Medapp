import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { iniciarAgenda, type Agenda } from './helpers.js';

let ag: Agenda;
const T = uuidv7();
const dr = uuidv7();
const tipo = uuidv7();
const CONTACTO = { nombre: 'Paciente', telefono: '5555555555' };

beforeAll(async () => {
  ag = await iniciarAgenda(); // reloj real: se usan fechas lejanas en el futuro
  await withTenant(ag.appPool, T, (tx) => tx.query("INSERT INTO consultorio (tenant_id, zona_horaria) VALUES ($1, 'America/Mexico_City')", [T]));
  await ag.sembrarMedico(T, dr, 'Dra. Ana');
  await withTenant(ag.appPool, T, async (tx) => {
    await tx.query("INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, 'Consulta', 30)", [tipo, T, dr]);
    // Lunes 09:00-12:00 local (2099-01-05 es lunes).
    await tx.query("INSERT INTO horario (id, tenant_id, medico_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, 1, '09:00', '12:00')", [uuidv7(), T, dr]);
  });
});
afterAll(async () => {
  await ag.stop();
});

const crear = async (inicio: string) =>
  ag.app.inject({
    method: 'POST',
    url: '/citas',
    headers: { authorization: `Bearer ${await ag.tokenPara({ tid: T, rol: 'recepcion' })}` },
    payload: { medicoId: dr, tipoCitaId: tipo, inicio, contacto: CONTACTO },
  });

test('dos POST simultáneos al mismo hueco → uno 201, otro 409 HORARIO_OCUPADO', async () => {
  const [a, b] = await Promise.all([crear('2099-01-05T15:00:00Z'), crear('2099-01-05T15:00:00Z')]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  const perdedora = a.statusCode === 409 ? a : b;
  expect(JSON.parse(perdedora.body)).toMatchObject({ code: 'HORARIO_OCUPADO' });
  const n = await withTenant(ag.appPool, T, (tx) => tx.query('SELECT 1 FROM cita WHERE lower(rango) = $1', ['2099-01-05T15:00:00Z']));
  expect(n.rowCount).toBe(1);
});

test('dos citas simultáneas que se enciman parcialmente → solo una gana', async () => {
  const [a, b] = await Promise.all([crear('2099-01-05T16:00:00Z'), crear('2099-01-05T16:15:00Z')]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
});

test('dos reprogramaciones simultáneas con la misma versión → una 200, otra 409 CONFLICTO_VERSION', async () => {
  const c = JSON.parse((await crear('2099-01-05T17:00:00Z')).body) as { id: string };
  const patch = async (inicio: string) =>
    ag.app.inject({
      method: 'PATCH',
      url: `/citas/${c.id}`,
      headers: { authorization: `Bearer ${await ag.tokenPara({ tid: T, rol: 'recepcion' })}` },
      payload: { version: 1, inicio },
    });
  const [a, b] = await Promise.all([patch('2099-01-05T15:30:00Z'), patch('2099-01-05T17:30:00Z')]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  const perdedora = a.statusCode === 409 ? a : b;
  expect(JSON.parse(perdedora.body)).toMatchObject({ code: 'CONFLICTO_VERSION' });
});
