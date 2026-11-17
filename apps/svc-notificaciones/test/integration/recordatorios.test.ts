import type { CitaParaRecordatorio, RecordatoriosRespuesta } from '@consultorio/contracts';
import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { iniciarNotificaciones, type Notificaciones } from './helpers.js';

let n: Notificaciones;
let ahora = new Date('2030-01-07T17:00:00.000Z'); // lunes 11:00 hora del consultorio (UTC-6): ya pasó la hora de envío (10:00)
let T: string;
const recepcionId = uuidv7();

beforeAll(async () => {
  n = await iniciarNotificaciones({ reloj: () => ahora });
}, 180_000);
afterAll(async () => {
  await n?.stop();
});
beforeEach(() => {
  T = uuidv7();
  ahora = new Date('2030-01-07T17:00:00.000Z');
  n.dobles.citas = [];
  n.dobles.correosEnviados.length = 0;
  n.dobles.fallaCorreo = null;
});

const cita = (over: Partial<CitaParaRecordatorio> = {}, email: string | null = 'ana@paciente.test'): CitaParaRecordatorio => ({
  citaId: uuidv7(),
  version: 1,
  inicio: '2030-01-08T15:00:00.000Z', // martes 09:00 local
  fin: '2030-01-08T15:30:00.000Z',
  estado: 'agendada',
  pideCambio: false,
  medicoId: uuidv7(),
  medicoNombre: 'Dra. Ruiz',
  tipoCitaNombre: 'Consulta',
  contacto: { nombre: 'Ana López', telefono: '5512345678', email },
  ...over,
});

async function llamar(metodo: 'GET' | 'POST' | 'PUT', url: string, o: { rol?: 'medico' | 'recepcion'; admin?: boolean; payload?: unknown; sub?: string } = {}) {
  const token = await n.tokenPara({ tid: T, rol: o.rol ?? 'recepcion', admin: o.admin ?? false, sub: o.sub ?? recepcionId });
  const r = await n.app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(o.payload !== undefined ? { payload: o.payload as object } : {}) });
  return { status: r.statusCode, cuerpo: (r.body ? JSON.parse(r.body) : undefined) as never as Record<string, unknown> };
}
const listar = async (desde = '2030-01-08', hasta = '2030-01-08') => {
  const r = await llamar('GET', `/recordatorios?desde=${desde}&hasta=${hasta}`);
  expect(r.status).toBe(200);
  return r.cuerpo as unknown as RecordatoriosRespuesta;
};
const envios = (canal?: string) =>
  withTenant(n.appPool, T, async (tx) => (await tx.query('SELECT * FROM envio WHERE ($1::text IS NULL OR canal = $1) ORDER BY creado_en', [canal ?? null])).rows as Record<string, unknown>[]);
const eventos = async (tipo: string) => (await n.migrator.query<{ payload: Record<string, unknown> }>('SELECT payload FROM outbox WHERE type = $1 AND tenant_id = $2', [tipo, T])).rows.map((r) => r.payload);

describe('GET /recordatorios', () => {
  test('combina citas y estados, crea los envíos y no guarda columnas de contacto en la base', async () => {
    const conCorreo = cita();
    const sinCorreo = cita({ contacto: { nombre: 'Luis', telefono: '5598765432', email: null } });
    const telMalo = cita({ contacto: { nombre: 'Eva', telefono: '123', email: 'eva@paciente.test' }, pideCambio: true });
    n.dobles.citas = [conCorreo, sinCorreo, telMalo];

    const r = await listar();
    expect(r.modo).toBe('con_revision');
    expect(r.horaEnvio).toBe('10:00');
    expect(r.citas).toHaveLength(3);
    const a = r.citas.find((c) => c.citaId === conCorreo.citaId)!;
    expect(a).toMatchObject({ fecha: '2030-01-08', paciente: 'Ana López', medico: 'Dra. Ruiz', estadoCita: 'agendada', pideCambio: false, respuesta: null });
    // Con revisión, sin aprobar y ya pasó la hora de envío de hoy.
    expect(a.correo).toMatchObject({ estado: 'pendiente', sinAprobarYVencido: true, enviableAhora: true });
    expect(a.correo.vistaPrevia?.asunto).toContain('Recordatorio de tu cita en Consultorio de prueba');
    expect(a.whatsapp).toMatchObject({ abierto: false, motivo: null });
    expect(a.whatsapp.enlace).toMatch(/^https:\/\/wa\.me\/525512345678\?text=/);
    expect(r.citas.find((c) => c.citaId === sinCorreo.citaId)!.correo).toEqual({ estado: 'sin_correo', sinAprobarYVencido: false, enviableAhora: false, vistaPrevia: null });
    const e = r.citas.find((c) => c.citaId === telMalo.citaId)!;
    expect(e).toMatchObject({ pideCambio: true, whatsapp: { enlace: null, motivo: 'telefono_invalido' } });

    // Solo hay envíos de correo de las citas con correo, y ninguna tabla guarda contacto.
    expect(await envios('correo')).toHaveLength(2);
    const cols = await n.migrator.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('envio', 'config_recordatorios', 'corrida', 'consultorio')",
    );
    expect(cols.rows.map((c) => c.column_name).filter((c) => /telefono|email|correo_destino|nombre|contacto/i.test(c))).toEqual([]);
    const volcado = JSON.stringify(await envios());
    expect(volcado).not.toMatch(/ana@paciente|Ana López|5512345678/);
  });

  test('una cita con respuesta la muestra; el consultorio queda registrado', async () => {
    const c = cita();
    n.dobles.citas = [c];
    await listar();
    await withTenant(n.appPool, T, (tx) => tx.query("UPDATE envio SET estado = 'enviado', respuesta = 'confirma', respondido_en = $1, respondido_por = 'paciente' WHERE cita_id = $2", [ahora, c.citaId]));
    const r = await listar();
    expect(r.citas[0]!.respuesta).toEqual({ valor: 'confirma', canal: 'correo', origen: 'paciente', respondidoEn: ahora.toISOString() });
    const zona = await withTenant(n.appPool, T, async (tx) => (await tx.query('SELECT zona_horaria FROM consultorio')).rows);
    expect(zona).toEqual([{ zona_horaria: 'America/Mexico_City' }]);
  });

  test('rango inválido o de más de 7 días → 400; médico sin admin → 403; admin médico → 200', async () => {
    expect((await llamar('GET', '/recordatorios?desde=2030-01-01&hasta=2030-01-08')).status).toBe(400);
    expect((await llamar('GET', '/recordatorios?desde=2030-01-08&hasta=2030-01-07')).status).toBe(400);
    expect((await llamar('GET', '/recordatorios?desde=hoy&hasta=mañana')).status).toBe(400);
    expect((await llamar('GET', '/recordatorios')).status).toBe(400);
    expect((await llamar('GET', '/recordatorios?desde=2030-01-01&hasta=2030-01-07')).status).toBe(200);
    expect((await llamar('GET', '/recordatorios?desde=2030-01-08&hasta=2030-01-08', { rol: 'medico' })).status).toBe(403);
    expect((await llamar('GET', '/recordatorios?desde=2030-01-08&hasta=2030-01-08', { rol: 'medico', admin: true })).status).toBe(200);
    const sinToken = await n.app.inject({ method: 'GET', url: '/recordatorios?desde=2030-01-08&hasta=2030-01-08' });
    expect(sinToken.statusCode).toBe(401);
  });
});

describe('aprobar', () => {
  test('recepción aprueba y, como ya pasó la hora de envío y la cita es mañana, sale en ese momento; médico no admin ni recepción → 403', async () => {
    const c = cita();
    n.dobles.citas = [c];
    await listar();
    expect((await llamar('POST', `/recordatorios/${c.citaId}/aprobar`, { rol: 'medico' })).status).toBe(403);
    expect(n.dobles.correosEnviados).toHaveLength(0);

    const r = await llamar('POST', `/recordatorios/${c.citaId}/aprobar`);
    expect(r.status).toBe(200);
    expect(r.cuerpo).toMatchObject({ citaId: c.citaId, estado: 'enviado', envio: 'enviado' });
    expect(n.dobles.correosEnviados).toHaveLength(1);
    expect(n.dobles.correosEnviados[0]!.para).toBe('ana@paciente.test');
    const [fila] = await envios('correo');
    expect(fila).toMatchObject({ estado: 'enviado', aprobado_por: recepcionId, enviado_por: recepcionId });

    // Aprobar otra vez no reenvía.
    expect((await llamar('POST', `/recordatorios/${c.citaId}/aprobar`)).cuerpo).toMatchObject({ estado: 'enviado' });
    expect(n.dobles.correosEnviados).toHaveLength(1);
    expect((await listar()).citas[0]!.correo.estado).toBe('enviado');
  });

  test('antes de la hora de envío solo queda aprobado (lo enviará la corrida del día)', async () => {
    ahora = new Date('2030-01-07T15:00:00.000Z'); // 09:00 local
    const c = cita();
    n.dobles.citas = [c];
    await listar();
    const r = await llamar('POST', `/recordatorios/${c.citaId}/aprobar`);
    expect(r.cuerpo).toMatchObject({ estado: 'aprobado', envio: 'no_intentado' });
    expect(n.dobles.correosEnviados).toHaveLength(0);
    expect((await envios('correo'))[0]).toMatchObject({ estado: 'aprobado', aprobado_por: recepcionId });
  });

  test('la hora de envío se movió después de la corrida de la víspera: aprobar a las 13:00 envía en ese momento', async () => {
    // La corrida de hoy ya corrió a las 10:00; luego el admin cambió la hora a 18:00 y son las 13:00.
    ahora = new Date('2030-01-07T19:00:00.000Z');
    const c = cita();
    n.dobles.citas = [c];
    const admin = await n.tokenPara({ tid: T, rol: 'medico', admin: true });
    const put = await n.app.inject({ method: 'PUT', url: '/config', headers: { authorization: `Bearer ${admin}` }, payload: { horaEnvio: '18:00' } });
    expect(put.statusCode).toBe(200);
    await listar();
    // Sin corrida registrada y antes de las 18:00 todavía no le toca salir.
    expect((await llamar('POST', `/recordatorios/${c.citaId}/aprobar`)).cuerpo).toMatchObject({ estado: 'aprobado' });
    expect(n.dobles.correosEnviados).toHaveLength(0);
    await withTenant(n.appPool, T, (tx) => tx.query("INSERT INTO corrida (tenant_id, fecha_envio) VALUES ($1, '2030-01-07')", [T]));
    const r = await llamar('POST', `/recordatorios/${c.citaId}/aprobar`);
    expect(r.cuerpo).toMatchObject({ estado: 'enviado' });
    expect(n.dobles.correosEnviados).toHaveLength(1);
  });

  test('cita sin envío conocido → 404; una cita ya empezada no se envía', async () => {
    expect((await llamar('POST', `/recordatorios/${uuidv7()}/aprobar`)).status).toBe(404);
    expect((await llamar('POST', '/recordatorios/no-es-uuid/aprobar')).status).toBe(400);
    ahora = new Date('2030-01-08T16:00:00.000Z'); // la cita de 15:00Z ya empezó
    const c = cita();
    n.dobles.citas = [c];
    await listar();
    expect((await llamar('POST', `/recordatorios/${c.citaId}/aprobar`)).cuerpo).toMatchObject({ estado: 'aprobado' });
    expect(n.dobles.correosEnviados).toHaveLength(0);
  });

  test('un fallo del correo deja los intentos contados; al tercero queda fallido y Reintentar lo reenvía', async () => {
    const c = cita();
    n.dobles.citas = [c];
    await listar();
    n.dobles.fallaCorreo = new Error('SMTP caído');
    for (const esperado of ['aprobado', 'aprobado', 'fallido']) {
      expect((await llamar('POST', `/recordatorios/${c.citaId}/aprobar`)).cuerpo).toMatchObject({ estado: esperado, envio: 'fallido' });
    }
    expect((await listar()).citas[0]!.correo.estado).toBe('fallido');
    expect((await llamar('POST', `/recordatorios/${c.citaId}/reintentar`, { rol: 'medico' })).status).toBe(403);

    n.dobles.fallaCorreo = null;
    const r = await llamar('POST', `/recordatorios/${c.citaId}/reintentar`);
    expect(r.cuerpo).toMatchObject({ estado: 'enviado', envio: 'enviado' });
    expect(n.dobles.correosEnviados).toHaveLength(1);
    expect((await envios('correo'))[0]).toMatchObject({ estado: 'enviado', intentos: 0 });
    // Ya enviado: no hay nada que reintentar.
    expect((await llamar('POST', `/recordatorios/${c.citaId}/reintentar`)).status).toBe(409);
    expect((await llamar('POST', `/recordatorios/${uuidv7()}/reintentar`)).status).toBe(404);
  });

  test('I1: Reintentar con SMTP caído responde envio fallido (no parece éxito)', async () => {
    const c = cita();
    n.dobles.citas = [c];
    await listar();
    await withTenant(n.appPool, T, (tx) => tx.query("UPDATE envio SET estado = 'fallido', intentos = 3 WHERE cita_id = $1", [c.citaId]));
    n.dobles.fallaCorreo = new Error('SMTP caído');
    const r = await llamar('POST', `/recordatorios/${c.citaId}/reintentar`);
    expect(r.status).toBe(200);
    expect(r.cuerpo).toMatchObject({ estado: 'aprobado', envio: 'fallido' });
    expect(n.dobles.correosEnviados).toHaveLength(0);
    n.dobles.fallaCorreo = null;
    expect((await llamar('POST', `/recordatorios/${c.citaId}/aprobar`)).cuerpo).toMatchObject({ estado: 'enviado', envio: 'enviado' });
  });

  test('I1: aprobar todos cuenta los envíos que fallan', async () => {
    const a = cita();
    const b = cita({ contacto: { nombre: 'Bea', telefono: '5511112222', email: 'bea@paciente.test' } });
    n.dobles.citas = [a, b];
    await listar();
    n.dobles.fallaCorreo = new Error('SMTP caído');
    const r = await llamar('POST', '/recordatorios/aprobar', { payload: { desde: '2030-01-08', hasta: '2030-01-08' } });
    expect(r.cuerpo).toEqual({ aprobados: 2, enviados: 0, fallidos: 2 });
  });

  test('I1: enviableAhora por fila — antes de la hora de envío es false; con la corrida de la víspera hecha es true; con la cita empezada, false', async () => {
    const c = cita();
    n.dobles.citas = [c];
    ahora = new Date('2030-01-07T15:00:00.000Z'); // 09:00 local, antes de las 10:00
    expect((await listar()).citas[0]!.correo.enviableAhora).toBe(false);
    await withTenant(n.appPool, T, (tx) => tx.query("INSERT INTO corrida (tenant_id, fecha_envio) VALUES ($1, '2030-01-07')", [T]));
    expect((await listar()).citas[0]!.correo.enviableAhora).toBe(true);
    ahora = new Date('2030-01-08T16:00:00.000Z');
    expect((await listar()).citas[0]!.correo.enviableAhora).toBe(false);
  });

  test('reintentar una cita que ya empezó → 409 y no envía', async () => {
    const c = cita();
    n.dobles.citas = [c];
    await listar();
    await withTenant(n.appPool, T, (tx) => tx.query("UPDATE envio SET estado = 'fallido', intentos = 3 WHERE cita_id = $1", [c.citaId]));
    ahora = new Date('2030-01-08T16:00:00.000Z');
    const r = await llamar('POST', `/recordatorios/${c.citaId}/reintentar`);
    expect(r.status).toBe(409);
    expect(String(r.cuerpo.message)).toMatch(/ya empezó/);
    expect(n.dobles.correosEnviados).toHaveLength(0);
    expect((await envios('correo'))[0]).toMatchObject({ estado: 'fallido', intentos: 3 });
    // Si la cita ya ni aparece en agenda tampoco se reenvía.
    ahora = new Date('2030-01-07T17:00:00.000Z');
    n.dobles.citas = [];
    expect((await llamar('POST', `/recordatorios/${c.citaId}/reintentar`)).status).toBe(409);
  });

  test('otro consultorio no puede aprobar ni abrir WhatsApp de una cita ajena (404) y nada cambia', async () => {
    const c = cita();
    n.dobles.citas = [c];
    await listar();
    const original = n.puertos.agenda.obtenerCitas;
    const duenio = T;
    // Como la agenda real, solo entrega las citas de su consultorio.
    n.puertos.agenda.obtenerCitas = async (tenantId) => (tenantId === duenio ? [c] : []);
    const antes = await envios();
    const otro = uuidv7();
    const tokenOtro = await n.tokenPara({ tid: otro, rol: 'recepcion' });
    const h = { authorization: `Bearer ${tokenOtro}` };
    try {
      expect((await n.app.inject({ method: 'POST', url: `/recordatorios/${c.citaId}/aprobar`, headers: h })).statusCode).toBe(404);
      expect((await n.app.inject({ method: 'POST', url: `/recordatorios/${c.citaId}/whatsapp`, headers: h, payload: { fecha: '2030-01-08' } })).statusCode).toBe(404);
      expect((await n.app.inject({ method: 'POST', url: `/recordatorios/${c.citaId}/reintentar`, headers: h })).statusCode).toBe(404);
    } finally {
      n.puertos.agenda.obtenerCitas = original;
    }
    expect(await envios()).toEqual(antes);
    expect(n.dobles.correosEnviados).toHaveLength(0);
    const deOtro = await withTenant(n.appPool, otro, async (tx) => (await tx.query('SELECT count(*)::int AS n FROM envio')).rows[0]);
    expect(deOtro).toEqual({ n: 0 });
  });

  test('aprobar todos: aprueba los pendientes del rango y envía los que ya corresponde', async () => {
    const a = cita();
    const b = cita({ contacto: { nombre: 'Bea', telefono: '5511112222', email: 'bea@paciente.test' } });
    const sin = cita({ contacto: { nombre: 'Sin', telefono: '5511112222', email: null } });
    n.dobles.citas = [a, b, sin];
    await listar();
    expect((await llamar('POST', '/recordatorios/aprobar', { rol: 'medico', payload: { desde: '2030-01-08', hasta: '2030-01-08' } })).status).toBe(403);
    expect((await llamar('POST', '/recordatorios/aprobar', { payload: { desde: '2030-01-01', hasta: '2030-01-31' } })).status).toBe(400);

    const r = await llamar('POST', '/recordatorios/aprobar', { payload: { desde: '2030-01-08', hasta: '2030-01-08' } });
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({ aprobados: 2, enviados: 2, fallidos: 0 });
    expect(n.dobles.correosEnviados.map((m) => m.para).sort()).toEqual(['ana@paciente.test', 'bea@paciente.test']);
    expect((await llamar('POST', '/recordatorios/aprobar', { payload: { desde: '2030-01-08', hasta: '2030-01-08' } })).cuerpo).toEqual({ aprobados: 0, enviados: 0, fallidos: 0 });
  });

  test('aprobar todos asegura los envíos aunque nadie haya abierto la pantalla', async () => {
    n.dobles.citas = [cita()];
    const r = await llamar('POST', '/recordatorios/aprobar', { payload: { desde: '2030-01-08', hasta: '2030-01-08' } });
    expect(r.cuerpo).toEqual({ aprobados: 1, enviados: 1, fallidos: 0 });
  });

  test('si el envío inmediato falla por una caída de agenda, la aprobación queda y la respuesta lo dice', async () => {
    const c = cita();
    n.dobles.citas = [c];
    await listar();
    const original = n.puertos.agenda.obtenerCitas;
    n.puertos.agenda.obtenerCitas = async () => {
      throw new Error('agenda caída');
    };
    try {
      const r = await llamar('POST', `/recordatorios/${c.citaId}/aprobar`);
      expect(r.status).toBe(200);
      expect(r.cuerpo).toMatchObject({ estado: 'aprobado', envio: 'no_intentado' });
    } finally {
      n.puertos.agenda.obtenerCitas = original;
    }
    expect((await envios('correo'))[0]).toMatchObject({ estado: 'aprobado' });
    // Aprobar de nuevo reintenta el envío.
    expect((await llamar('POST', `/recordatorios/${c.citaId}/aprobar`)).cuerpo).toMatchObject({ estado: 'enviado' });
  });
});

describe('WhatsApp y respuestas de recepción', () => {
  test('abrir WhatsApp registra "abierto" y devuelve el enlace; teléfono no válido → 400; cita desconocida → 404', async () => {
    const c = cita({ contacto: { nombre: 'Ana López', telefono: '5512345678', email: null } });
    const mala = cita({ contacto: { nombre: 'Mala', telefono: '12', email: null } });
    n.dobles.citas = [c, mala];
    expect((await llamar('POST', `/recordatorios/${c.citaId}/whatsapp`, { rol: 'medico', payload: { fecha: '2030-01-08' } })).status).toBe(403);
    const r = await llamar('POST', `/recordatorios/${c.citaId}/whatsapp`, { payload: { fecha: '2030-01-08' } });
    expect(r.status).toBe(200);
    expect(String(r.cuerpo.enlace)).toMatch(/^https:\/\/wa\.me\/525512345678\?text=Hola%20Ana/);
    expect((await envios('whatsapp_asistido'))[0]).toMatchObject({ estado: 'enviado', enviado_por: recepcionId });
    expect((await listar()).citas.find((x) => x.citaId === c.citaId)!.whatsapp.abierto).toBe(true);
    // Abrirlo otra vez no duplica el envío.
    await llamar('POST', `/recordatorios/${c.citaId}/whatsapp`, { payload: { fecha: '2030-01-08' } });
    expect(await envios('whatsapp_asistido')).toHaveLength(1);

    expect((await llamar('POST', `/recordatorios/${mala.citaId}/whatsapp`, { payload: { fecha: '2030-01-08' } })).status).toBe(400);
    expect((await llamar('POST', `/recordatorios/${uuidv7()}/whatsapp`, { payload: { fecha: '2030-01-08' } })).status).toBe(404);
    expect((await llamar('POST', `/recordatorios/${c.citaId}/whatsapp`, { payload: {} })).status).toBe(400);
  });

  test('respuesta por WhatsApp registrada por recepción emite cita.respuesta_paciente origen recepcion', async () => {
    const c = cita({ contacto: { nombre: 'Ana López', telefono: '5512345678', email: null } });
    n.dobles.citas = [c];
    expect((await llamar('POST', `/recordatorios/${c.citaId}/respuesta`, { rol: 'medico', payload: { fecha: '2030-01-08', respuesta: 'confirma' } })).status).toBe(403);
    expect((await llamar('POST', `/recordatorios/${c.citaId}/respuesta`, { payload: { fecha: '2030-01-08', respuesta: 'quizá' } })).status).toBe(400);
    expect((await llamar('POST', `/recordatorios/${uuidv7()}/respuesta`, { payload: { fecha: '2030-01-08', respuesta: 'confirma' } })).status).toBe(404);

    const r = await llamar('POST', `/recordatorios/${c.citaId}/respuesta`, { payload: { fecha: '2030-01-08', respuesta: 'confirma' } });
    expect(r.status).toBe(200);
    const [wa] = await envios('whatsapp_asistido');
    expect(wa).toMatchObject({ estado: 'enviado', respuesta: 'confirma', respondido_por: recepcionId });
    const [ev] = await eventos('cita.respuesta_paciente');
    expect(ev).toMatchObject({
      type: 'cita.respuesta_paciente',
      version: 1,
      tenant_id: T,
      actor_id: recepcionId,
      data: { citaId: c.citaId, inicioCita: c.inicio, respuesta: 'confirma', canal: 'whatsapp_asistido', origen: 'recepcion' },
    });
    expect(JSON.stringify(ev)).not.toMatch(/5512345678|Ana/);
    expect((await listar()).citas[0]!.respuesta).toMatchObject({ valor: 'confirma', canal: 'whatsapp_asistido', origen: 'recepcion' });

    // Cambiar la respuesta la reemplaza y emite otro evento.
    await llamar('POST', `/recordatorios/${c.citaId}/respuesta`, { payload: { fecha: '2030-01-08', respuesta: 'cancela' } });
    expect((await envios('whatsapp_asistido'))[0]).toMatchObject({ respuesta: 'cancela' });
    expect(await eventos('cita.respuesta_paciente')).toHaveLength(2);
  });
});
