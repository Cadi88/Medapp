import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PLANTILLAS_POR_OMISION } from '../../src/dominio/plantillas.js';
import { iniciarNotificaciones, type Notificaciones } from './helpers.js';

let n: Notificaciones;
let T: string;
const adminId = uuidv7();

beforeAll(async () => {
  n = await iniciarNotificaciones();
}, 180_000);
afterAll(async () => {
  await n?.stop();
});
beforeEach(() => {
  T = uuidv7();
});

async function llamar(metodo: 'GET' | 'PUT', o: { rol?: 'medico' | 'recepcion'; admin?: boolean; payload?: unknown } = {}) {
  const token = await n.tokenPara({ tid: T, rol: o.rol ?? 'recepcion', admin: o.admin ?? false, sub: adminId });
  const r = await n.app.inject({ method: metodo, url: '/config', headers: { authorization: `Bearer ${token}` }, ...(o.payload !== undefined ? { payload: o.payload as object } : {}) });
  return { status: r.statusCode, cuerpo: JSON.parse(r.body) as Record<string, unknown> };
}
const eventos = async () => (await n.migrator.query<{ payload: Record<string, unknown> }>("SELECT payload FROM outbox WHERE type = 'config_recordatorios.actualizada' AND tenant_id = $1", [T])).rows.map((r) => r.payload);
const fila = () => withTenant(n.appPool, T, async (tx) => (await tx.query('SELECT * FROM config_recordatorios')).rows[0] as Record<string, unknown> | undefined);

describe('GET /config', () => {
  test('sin fila rige la configuración por omisión; recepción y admin la ven, un médico sin admin no', async () => {
    const r = await llamar('GET');
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({ modo: 'con_revision', horaEnvio: '10:00', plantillas: PLANTILLAS_POR_OMISION });
    expect((await llamar('GET', { rol: 'medico', admin: true })).status).toBe(200);
    expect((await llamar('GET', { rol: 'medico' })).status).toBe(403);
    expect(await fila()).toBeUndefined();
  });

  test('sin token → 401', async () => {
    expect((await n.app.inject({ method: 'GET', url: '/config' })).statusCode).toBe(401);
  });
});

describe('PUT /config', () => {
  test('el admin cambia modo, hora y plantillas; se guarda la zona del consultorio y se emite el evento con los campos cambiados', async () => {
    const r = await llamar('PUT', { admin: true, rol: 'medico', payload: { modo: 'sin_revision', horaEnvio: '08:30', plantillas: { whatsapp: 'Hola {paciente}' } } });
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({ modo: 'sin_revision', horaEnvio: '08:30', plantillas: { ...PLANTILLAS_POR_OMISION, whatsapp: 'Hola {paciente}' } });
    expect(await fila()).toMatchObject({ modo: 'sin_revision', hora_envio: '08:30:00', zona_horaria: 'America/Mexico_City', actualizada_por: adminId, plantilla_whatsapp: 'Hola {paciente}' });
    const consultorios = await withTenant(n.appPool, T, async (tx) => (await tx.query('SELECT zona_horaria FROM consultorio')).rows);
    expect(consultorios).toEqual([{ zona_horaria: 'America/Mexico_City' }]);

    const [ev] = await eventos();
    expect(ev).toMatchObject({ type: 'config_recordatorios.actualizada', version: 1, tenant_id: T, actor_id: adminId, data: { campos: ['modo', 'horaEnvio', 'plantillaWhatsapp'] } });
    expect((await llamar('GET')).cuerpo).toMatchObject({ modo: 'sin_revision', horaEnvio: '08:30' });
  });

  test('plantilla de 1001 caracteres → 400 y no cambia nada; asunto de 121 y plantilla vacía también', async () => {
    const largo = await llamar('PUT', { admin: true, payload: { plantillas: { correoCuerpo: 'x'.repeat(1001) } } });
    expect(largo.status).toBe(400);
    expect(largo.cuerpo.code).toBe('VALIDACION');
    expect((await llamar('PUT', { admin: true, payload: { plantillas: { correoAsunto: 'x'.repeat(121) } } })).status).toBe(400);
    expect((await llamar('PUT', { admin: true, payload: { plantillas: { whatsapp: 'x'.repeat(701) } } })).status).toBe(400);
    expect((await llamar('PUT', { admin: true, payload: { plantillas: { whatsapp: '   ' } } })).status).toBe(400);
    expect((await llamar('PUT', { admin: true, payload: { plantillas: { correoCuerpo: 'x'.repeat(1000) } } })).status).toBe(200);
    expect(await eventos()).toHaveLength(1);
  });

  test('recepción (sin admin) → 403 y no escribe', async () => {
    expect((await llamar('PUT', { payload: { modo: 'sin_revision' } })).status).toBe(403);
    expect((await llamar('PUT', { rol: 'medico', payload: { modo: 'sin_revision' } })).status).toBe(403);
    expect(await fila()).toBeUndefined();
    expect(await eventos()).toHaveLength(0);
  });

  test('cuerpo inválido (modo, hora o campo desconocido) → 400', async () => {
    for (const payload of [{ modo: 'raro' }, { horaEnvio: '25:00' }, { horaEnvio: '9:00' }, { otro: 1 }, { plantillas: { otra: 'x' } }]) {
      expect((await llamar('PUT', { admin: true, payload })).status).toBe(400);
    }
  });

  test('guardar sin cambios no emite evento; un cambio posterior emite solo lo que cambió', async () => {
    await llamar('PUT', { admin: true, payload: { modo: 'con_revision', horaEnvio: '10:00' } });
    expect(await eventos()).toHaveLength(0);
    await llamar('PUT', { admin: true, payload: { horaEnvio: '11:15' } });
    await llamar('PUT', { admin: true, payload: { horaEnvio: '11:15' } });
    const evs = await eventos();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ data: { campos: ['horaEnvio'] } });
  });
});
