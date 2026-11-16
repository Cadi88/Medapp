import { jetstream } from '@nats-io/jetstream';
import { CitaCreada, type CitaParaRecordatorio } from '@consultorio/contracts';
import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { iniciarConsumidor } from '../../src/consumidor.js';
import { registrarConsultorio } from '../../src/datos/consultorios.js';
import type { ContextoEnvio } from '../../src/envio.js';
import { enviarInmediato, iniciarProgramador } from '../../src/programador.js';
import { WEB_ORIGEN_PRUEBA, iniciarNotificaciones, type Notificaciones } from './helpers.js';

let n: Notificaciones;
let ahora: Date;
let agendaCaida: Set<string>;
let ctx: ContextoEnvio;
const programadores: { detener(): Promise<void> }[] = [];

beforeAll(async () => {
  n = await iniciarNotificaciones();
  ctx = {
    pool: n.appPool,
    puertos: {
      ...n.puertos,
      agenda: {
        obtenerCitas: async (t, d, h) => {
          if (agendaCaida.has(t)) throw new Error('agenda caída');
          return n.puertos.agenda.obtenerCitas(t, d, h);
        },
      },
    },
    reloj: () => ahora,
    webOrigen: WEB_ORIGEN_PRUEBA,
  };
}, 180_000);
afterAll(async () => {
  await n?.stop();
});
beforeEach(async () => {
  agendaCaida = new Set();
  n.dobles.citas = [];
  n.dobles.correosEnviados.length = 0;
  n.dobles.fallaCorreo = null;
  n.dobles.consultorio = { ...n.dobles.consultorio, zonaHoraria: 'America/Mexico_City' };
  // El programador recorre todos los consultorios: cada prueba parte de una base vacía.
  await n.migrator.query('TRUNCATE envio, corrida, consultorio, config_recordatorios');
  while (programadores.length) await programadores.pop()!.detener();
});

const programador = () => {
  const p = iniciarProgramador(ctx, { reloj: () => ahora, intervaloMs: 3_600_000 });
  programadores.push(p);
  return p;
};
const registrar = (t: string, zona = 'America/Mexico_City') => withTenant(n.appPool, t, (tx) => registrarConsultorio(tx, t, zona));
const configurar = (t: string, modo: 'con_revision' | 'sin_revision', hora = '10:00') =>
  withTenant(n.appPool, t, (tx) =>
    tx.query(
      `INSERT INTO config_recordatorios (tenant_id, modo, hora_envio, zona_horaria, plantilla_correo_asunto, plantilla_correo_cuerpo, plantilla_whatsapp, actualizada_por)
       VALUES ($1, $2, $3, 'America/Mexico_City', 'Recordatorio {consultorio}', 'Hola {paciente}, cita {fecha} {hora}', 'wa {paciente}', $4)`,
      [t, modo, hora, uuidv7()],
    ),
  );
function nuevaCita(inicio: string, email: string | null = `${uuidv7()}@paciente.test`): CitaParaRecordatorio {
  return {
    citaId: uuidv7(),
    version: 1,
    inicio,
    fin: new Date(Date.parse(inicio) + 30 * 60_000).toISOString(),
    estado: 'agendada',
    pideCambio: false,
    medicoId: uuidv7(),
    medicoNombre: 'Dra. Pérez',
    tipoCitaNombre: 'Consulta',
    contacto: { nombre: 'Ana Gómez', telefono: '+525598765432', email },
  };
}
const aprobar = (t: string, citaId: string, fecha: string) =>
  withTenant(n.appPool, t, (tx) =>
    tx.query("INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, estado) VALUES ($1, $2, $3, $4, 'correo', 'aprobado')", [uuidv7(), t, citaId, fecha]),
  );
const corridas = (t: string) => withTenant(n.appPool, t, async (tx) => (await tx.query('SELECT fecha_envio::text AS f FROM corrida')).rows.map((r) => r.f as string));
const estados = (t: string) => withTenant(n.appPool, t, async (tx) => (await tx.query('SELECT cita_id, estado FROM envio ORDER BY creado_en')).rows as { cita_id: string; estado: string }[]);
const destinos = () => n.dobles.correosEnviados.map((c) => c.para);

describe('programador automático', () => {
  test('antes de la hora no envía; a las 10:00 locales envía los aprobados de mañana y registra la corrida', async () => {
    const T = uuidv7();
    await registrar(T);
    const c = nuevaCita('2031-05-02T17:30:00.000Z');
    n.dobles.citas = [c];
    await aprobar(T, c.citaId, '2031-05-02');
    const p = programador();

    ahora = new Date('2031-05-01T15:59:00.000Z'); // 09:59 en Ciudad de México
    await p.correrAhora();
    expect(destinos()).toEqual([]);
    expect(await corridas(T)).toEqual([]);

    ahora = new Date('2031-05-01T16:00:00.000Z'); // 10:00
    await p.correrAhora();
    expect(destinos()).toEqual([c.contacto.email]);
    expect(await corridas(T)).toEqual(['2031-05-01']);
    expect((await estados(T))[0]?.estado).toBe('enviado');

    ahora = new Date('2031-05-01T16:01:00.000Z');
    await p.correrAhora();
    expect(destinos()).toHaveLength(1);
  });

  test('Review Focus 2: dos programadores a la vez (dos instancias) → cada correo sale una vez', async () => {
    const T = uuidv7();
    await registrar(T);
    await configurar(T, 'sin_revision');
    const citas = [nuevaCita('2031-05-02T17:00:00.000Z'), nuevaCita('2031-05-02T18:00:00.000Z')];
    n.dobles.citas = citas;
    ahora = new Date('2031-05-01T16:00:00.000Z');
    const a = programador();
    const b = programador();
    await Promise.all([a.correrAhora(), b.correrAhora(), a.correrAhora(), b.correrAhora()]);
    expect(destinos().sort()).toEqual(citas.map((c) => c.contacto.email).sort());
    expect(await corridas(T)).toEqual(['2031-05-01']);
  });

  test('Review Focus 3: domingo 10:00 America/Tijuana envía las citas del lunes', async () => {
    const T = uuidv7();
    n.dobles.consultorio = { ...n.dobles.consultorio, zonaHoraria: 'America/Tijuana' };
    await registrar(T, 'America/Tijuana');
    await configurar(T, 'sin_revision');
    const lunes = nuevaCita('2031-05-05T17:00:00.000Z'); // lunes 10:00 PDT
    n.dobles.citas = [lunes];
    ahora = new Date('2031-05-04T17:00:00.000Z'); // domingo 10:00 PDT
    expect(new Date('2031-05-04T12:00:00Z').getUTCDay()).toBe(0);
    await programador().correrAhora();
    expect(destinos()).toEqual([lunes.contacto.email]);
    expect(await corridas(T)).toEqual(['2031-05-04']);
  });

  test('sin_revision envía los pendientes; con_revision deja "Sin aprobar" sin enviar', async () => {
    const SIN = uuidv7();
    const CON = uuidv7();
    await registrar(SIN);
    await registrar(CON);
    await configurar(SIN, 'sin_revision');
    const c = nuevaCita('2031-05-02T17:30:00.000Z');
    n.dobles.citas = [c];
    ahora = new Date('2031-05-01T16:00:00.000Z');
    await programador().correrAhora();
    expect(destinos()).toEqual([c.contacto.email]); // solo SIN: CON no tiene config y rige con_revision
    expect((await estados(SIN)).map((e) => e.estado)).toEqual(['enviado']);
    expect((await estados(CON)).map((e) => e.estado)).toEqual(['pendiente']);
    expect(await corridas(CON)).toEqual(['2031-05-01']);
  });

  test('agenda caída: no registra corrida y la siguiente vuelta lo reintenta; otro consultorio no se ve afectado', async () => {
    const A = uuidv7();
    const B = uuidv7();
    await registrar(A);
    await registrar(B);
    await configurar(A, 'sin_revision');
    await configurar(B, 'sin_revision');
    const c = nuevaCita('2031-05-02T17:30:00.000Z');
    n.dobles.citas = [c];
    ahora = new Date('2031-05-01T16:00:00.000Z');
    agendaCaida = new Set([A]);
    const p = programador();
    await p.correrAhora();
    expect(await corridas(A)).toEqual([]);
    expect(await corridas(B)).toEqual(['2031-05-01']);
    expect(destinos()).toEqual([c.contacto.email]);

    agendaCaida = new Set();
    ahora = new Date('2031-05-01T16:01:00.000Z');
    await p.correrAhora();
    expect(await corridas(A)).toEqual(['2031-05-01']);
    expect(destinos()).toHaveLength(2);
  });

  test('un fallo transitorio del correo no registra la corrida y se reintenta; tras 3 intentos queda fallido y la corrida se registra', async () => {
    const T = uuidv7();
    await registrar(T);
    await configurar(T, 'sin_revision');
    n.dobles.citas = [nuevaCita('2031-05-02T17:30:00.000Z')];
    n.dobles.fallaCorreo = new Error('smtp caído');
    ahora = new Date('2031-05-01T16:00:00.000Z');
    const p = programador();
    await p.correrAhora();
    await p.correrAhora();
    expect(await corridas(T)).toEqual([]);
    await p.correrAhora();
    expect((await estados(T))[0]?.estado).toBe('fallido');
    expect(await corridas(T)).toEqual(['2031-05-01']);
  });
});

describe('envío inmediato de citas tardías', () => {
  test('sin_revision, mañana y pasada la hora → sale de inmediato (y una sola vez)', async () => {
    const T = uuidv7();
    await registrar(T);
    await configurar(T, 'sin_revision');
    const c = nuevaCita('2031-05-02T17:30:00.000Z');
    n.dobles.citas = [c];
    ahora = new Date('2031-05-01T20:00:00.000Z');
    await enviarInmediato(ctx, T, c.citaId, c.inicio);
    expect(destinos()).toEqual([c.contacto.email]);
    await enviarInmediato(ctx, T, c.citaId, c.inicio);
    expect(destinos()).toHaveLength(1);
  });

  test.each([
    ['con_revision', '2031-05-01T20:00:00.000Z', '2031-05-02T17:30:00.000Z'],
    ['sin_revision', '2031-05-01T15:00:00.000Z', '2031-05-02T17:30:00.000Z'], // aún no es la hora: lo enviará la corrida
    ['sin_revision', '2031-05-01T20:00:00.000Z', '2031-05-03T17:30:00.000Z'], // no es mañana
  ] as const)('%s, ahora %s, cita %s → no sale', async (modo, hora, inicio) => {
    const T = uuidv7();
    await registrar(T);
    await configurar(T, modo);
    const c = nuevaCita(inicio);
    n.dobles.citas = [c];
    ahora = new Date(hora);
    await enviarInmediato(ctx, T, c.citaId, c.inicio);
    expect(destinos()).toEqual([]);
  });

  test('un consultorio desconocido se ignora', async () => {
    const c = nuevaCita('2031-05-02T17:30:00.000Z');
    ahora = new Date('2031-05-01T20:00:00.000Z');
    await enviarInmediato(ctx, uuidv7(), c.citaId, c.inicio);
    expect(destinos()).toEqual([]);
  });

  test('cita.creada para mañana tras la corrida en sin_revision → el consumidor la envía al confirmarse la transacción', async () => {
    const T = uuidv7();
    await configurar(T, 'sin_revision');
    const c = nuevaCita('2031-05-02T17:30:00.000Z');
    n.dobles.citas = [c];
    ahora = new Date('2031-05-01T20:00:00.000Z');
    const consumidor = await iniciarConsumidor({ pool: n.appPool, nc: n.nc, identidad: n.puertos.identidad, envio: ctx });
    try {
      await jetstream(n.nc).publish(
        'evt.cita.creada',
        JSON.stringify(
          CitaCreada.create({
            tenantId: T,
            actorId: null,
            traceId: 'trace-prueba',
            data: { citaId: c.citaId, medicoId: c.medicoId, inicio: c.inicio, fin: c.fin, tipoCitaId: uuidv7(), estado: 'agendada', origen: 'recepcion', fueraDeHorario: false },
          }),
        ),
      );
      const fin = Date.now() + 20_000;
      while (destinos().length === 0 && Date.now() < fin) await new Promise((r) => setTimeout(r, 100));
      expect(destinos()).toEqual([c.contacto.email]);
    } finally {
      await consumidor.stop();
    }
  });
});
