import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { cambiarEstadoCita, insertarCita, leerCita, reprogramarCita } from '../../src/datos/citas.js';
import { iniciarAgenda, type Agenda } from './helpers.js';

let ag: Agenda;
const T = uuidv7();
const dr = uuidv7();
const tipo = uuidv7();

beforeAll(async () => {
  ag = await iniciarAgenda();
  await ag.sembrarMedico(T, dr, 'Dra. Ana');
  await withTenant(ag.appPool, T, (tx) => tx.query("INSERT INTO tipo_cita (id, tenant_id, medico_id, nombre, duracion_min) VALUES ($1, $2, $3, 'Consulta', 30)", [tipo, T, dr]));
});
afterAll(async () => {
  await ag.stop();
});

const nueva = (id: string) => ({
  id,
  medicoId: dr,
  tipoCitaId: tipo,
  inicio: '2099-01-05T15:00:00Z',
  fin: '2099-01-05T15:30:00Z',
  contacto: { nombre: 'P', telefono: '5555555555' },
  fueraDeHorario: false,
  creadaPor: uuidv7(),
});

test('reprogramarCita y cambiarEstadoCita con versión obsoleta devuelven null y no tocan la fila', async () => {
  const id = uuidv7();
  await withTenant(ag.appPool, T, async (tx) => {
    await insertarCita(tx, T, nueva(id));
    const ok = await cambiarEstadoCita(tx, T, id, 1, 'confirmada');
    expect(ok).toMatchObject({ estado: 'confirmada', version: 2 });

    const r = await reprogramarCita(tx, T, id, 1, { medicoId: dr, tipoCitaId: tipo, inicio: '2099-01-05T16:00:00Z', fin: '2099-01-05T16:30:00Z', fueraDeHorario: true });
    expect(r).toBeNull();
    expect(await cambiarEstadoCita(tx, T, id, 1, 'cancelada')).toBeNull();

    expect(await leerCita(tx, T, id)).toMatchObject({ estado: 'confirmada', version: 2, inicio: '2099-01-05T15:00:00.000Z', fueraDeHorario: false });
  });
});
