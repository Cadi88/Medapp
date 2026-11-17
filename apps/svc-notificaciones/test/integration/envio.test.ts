import type { CitaParaRecordatorio } from '@consultorio/contracts';
import { createLogger, withTenant } from '@consultorio/platform';
import { startMailpit, type TestMailpit } from '@consultorio/platform/testing';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { crearCanalSmtp } from '../../src/correo/smtp.js';
import { ultimaCorrida, registrarCorrida } from '../../src/datos/corridas.js';
import { asegurarEnvios, enviarCorreo, type ContextoEnvio } from '../../src/envio.js';
import { hashDeToken } from '../../src/dominio/token.js';
import { iniciarNotificaciones, WEB_ORIGEN_PRUEBA, type Notificaciones } from './helpers.js';

let n: Notificaciones;
let mailpit: TestMailpit;
let ctx: ContextoEnvio;
const lineasLog: string[] = [];
const AHORA = new Date('2031-05-01T16:00:00.000Z');
const TELEFONO_PACIENTE = '+525598765432';

beforeAll(async () => {
  [n, mailpit] = await Promise.all([iniciarNotificaciones(), startMailpit()]);
  const correo = crearCanalSmtp({ host: mailpit.smtpHost, puerto: mailpit.smtpPort, remitente: 'Consultorio <no-responder@consultorio.test>' });
  const logger = createLogger('svc-notificaciones-test', { write: (l: string) => void lineasLog.push(l) });
  ctx = { pool: n.appPool, puertos: { ...n.puertos, correo }, reloj: () => AHORA, webOrigen: WEB_ORIGEN_PRUEBA, logger };
}, 180_000);
afterAll(async () => {
  await Promise.all([n?.stop(), mailpit?.stop()]);
});

function nuevaCita(over: Partial<CitaParaRecordatorio> = {}, email: string | null = `${uuidv7()}@paciente.test`): CitaParaRecordatorio {
  return {
    citaId: uuidv7(),
    version: 1,
    inicio: '2031-05-02T17:30:00.000Z',
    fin: '2031-05-02T18:00:00.000Z',
    estado: 'agendada',
    pideCambio: false,
    medicoId: uuidv7(),
    medicoNombre: 'Dra. Pérez',
    tipoCitaNombre: 'Consulta',
    contacto: { nombre: 'Ana Gómez', telefono: TELEFONO_PACIENTE, email },
    ...over,
  };
}

async function crearEnvio(t: string, c: CitaParaRecordatorio, estado: string, fecha = '2031-05-02'): Promise<string> {
  const id = uuidv7();
  await withTenant(n.appPool, t, (tx) =>
    tx.query("INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, estado) VALUES ($1, $2, $3, $4, 'correo', $5)", [id, t, c.citaId, fecha, estado]),
  );
  return id;
}
const leerEnvio = (t: string, id: string) =>
  withTenant(n.appPool, t, async (tx) => (await tx.query('SELECT * FROM envio WHERE id = $1', [id])).rows[0]);
const correosA = async (email: string) => (await mailpit.mensajes()).filter((m) => m.para === email);
const configurar = (t: string, modo: 'con_revision' | 'sin_revision', asunto = 'Recordatorio {consultorio}') =>
  withTenant(n.appPool, t, (tx) =>
    tx.query(
      `INSERT INTO config_recordatorios (tenant_id, modo, zona_horaria, plantilla_correo_asunto, plantilla_correo_cuerpo, plantilla_whatsapp, actualizada_por)
       VALUES ($1, $2, 'America/Mexico_City', $3, 'Hola {paciente}, cita {fecha} {hora} con {medico}', 'wa {paciente}', $4)`,
      [t, modo, asunto, uuidv7()],
    ),
  );

describe('enviarCorreo', () => {
  test('con_revision: pendiente → omitido; aprobado → enviado y llega a Mailpit con los enlaces /r/ (token solo como hash)', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [c];
    const pendiente = await crearEnvio(T, c, 'pendiente');
    expect((await enviarCorreo(ctx, T, pendiente)).resultado).toBe('omitido');
    expect(await correosA(c.contacto.email!)).toEqual([]);

    const aprobado = uuidv7();
    await withTenant(n.appPool, T, async (tx) => {
      await tx.query('DELETE FROM envio WHERE id = $1', [pendiente]);
      await tx.query("INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, estado) VALUES ($1, $2, $3, '2031-05-02', 'correo', 'aprobado')", [aprobado, T, c.citaId]);
    });
    const actor = uuidv7();
    expect((await enviarCorreo(ctx, T, aprobado, actor)).resultado).toBe('enviado');

    const [correo, ...resto] = await correosA(c.contacto.email!);
    expect(resto).toEqual([]);
    expect(correo?.asunto).toBe('Recordatorio de tu cita en Consultorio de prueba');
    const enlaces = [...(correo?.html.matchAll(/href="(http:\/\/web\.test\/r\/([\w-]{43})\?accion=([a-z_]+))"/g) ?? [])];
    expect(enlaces.map((m) => m[3])).toEqual(['confirma', 'cancela', 'pide_cambio']);
    const token = enlaces[0]![2]!;
    expect(new Set(enlaces.map((m) => m[2]))).toEqual(new Set([token]));

    const fila = await leerEnvio(T, aprobado);
    expect(fila).toMatchObject({ estado: 'enviado', intentos: 0, enviado_por: actor, token_hash: hashDeToken(token) });
    expect(fila.token_hash).not.toBe(token);
    expect(fila.enviado_en.toISOString()).toBe(AHORA.toISOString());
    expect(fila.token_expira_en.toISOString()).toBe(new Date(c.inicio).toISOString());
  });

  test('sin_revision: un pendiente se envía con la plantilla del consultorio; el envío automático deja enviado_por nulo', async () => {
    const T = uuidv7();
    await configurar(T, 'sin_revision', 'Cita con {medico}');
    const c = nuevaCita();
    n.dobles.citas = [c];
    const id = await crearEnvio(T, c, 'pendiente');
    expect((await enviarCorreo(ctx, T, id)).resultado).toBe('enviado');
    expect((await correosA(c.contacto.email!))[0]?.asunto).toBe('Cita con Dra. Pérez');
    expect((await leerEnvio(T, id)).enviado_por).toBeNull();
  });

  test('dos veces el mismo envío → un solo correo en Mailpit', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [c];
    const id = await crearEnvio(T, c, 'aprobado');
    expect((await enviarCorreo(ctx, T, id)).resultado).toBe('enviado');
    const hash = (await leerEnvio(T, id)).token_hash;
    expect((await enviarCorreo(ctx, T, id)).resultado).toBe('omitido');
    expect(await correosA(c.contacto.email!)).toHaveLength(1);
    expect((await leerEnvio(T, id)).token_hash).toBe(hash);
  });

  test('SMTP caído: tres intentos y queda fallido, sin token vigente; después ya no se reintenta', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [c];
    const id = await crearEnvio(T, c, 'aprobado');
    const caido = { ...ctx, puertos: { ...ctx.puertos, correo: crearCanalSmtp({ host: '127.0.0.1', puerto: 1, remitente: 'x@consultorio.test' }) } };
    expect(await enviarCorreo(caido, T, id)).toEqual({ resultado: 'fallido', estado: 'aprobado', intentos: 1 });
    expect(await leerEnvio(T, id)).toMatchObject({ estado: 'aprobado', intentos: 1, token_hash: null, reclamado_en: null });
    expect((await enviarCorreo(caido, T, id)).resultado).toBe('fallido');
    expect(await enviarCorreo(caido, T, id)).toEqual({ resultado: 'fallido', estado: 'fallido', intentos: 3 });
    expect(await leerEnvio(T, id)).toMatchObject({ estado: 'fallido', intentos: 3, token_hash: null });
    expect((await enviarCorreo(ctx, T, id)).resultado).toBe('omitido');
    expect(await correosA(c.contacto.email!)).toEqual([]);
  });

  test('un fallo del doble de correo también cuenta como intento', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [c];
    const id = await crearEnvio(T, c, 'aprobado');
    n.dobles.fallaCorreo = new Error('boom');
    try {
      expect((await enviarCorreo({ ...ctx, puertos: n.puertos }, T, id)).resultado).toBe('fallido');
    } finally {
      n.dobles.fallaCorreo = null;
    }
    expect((await leerEnvio(T, id)).intentos).toBe(1);
  });

  test('cita sin correo → omitido y asegurarEnvios no crea fila de correo', async () => {
    const T = uuidv7();
    const sin = nuevaCita({}, null);
    const vacio = nuevaCita({}, '   ');
    const con = nuevaCita();
    n.dobles.citas = [sin, vacio, con];
    await asegurarEnvios(ctx, T, '2031-05-02', '2031-05-02');
    const filas = await withTenant(n.appPool, T, async (tx) => (await tx.query('SELECT cita_id FROM envio')).rows);
    expect(filas).toEqual([{ cita_id: con.citaId }]);
    const id = await crearEnvio(T, sin, 'aprobado');
    expect((await enviarCorreo(ctx, T, id)).resultado).toBe('omitido');
    expect((await leerEnvio(T, id)).estado).toBe('aprobado');
  });

  test('cita que ya no está en agenda (o envío inexistente) → omitido', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [];
    const id = await crearEnvio(T, c, 'aprobado');
    expect((await enviarCorreo(ctx, T, id)).resultado).toBe('omitido');
    expect((await enviarCorreo(ctx, T, uuidv7())).resultado).toBe('omitido');
  });

  test('el logo del consultorio viaja como adjunto en línea cuando existe en el almacén', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [c];
    n.dobles.consultorio = { ...n.dobles.consultorio, logoKey: `logos/${T}/a.png` };
    n.dobles.logos.set(`logos/${T}/a.png`, { bytes: new Uint8Array([137, 80, 78, 71]), tipo: 'image/png' });
    try {
      expect((await enviarCorreo(ctx, T, await crearEnvio(T, c, 'aprobado'))).resultado).toBe('enviado');
      expect((await correosA(c.contacto.email!))[0]?.html).toContain('cid:logo');
    } finally {
      n.dobles.consultorio = { ...n.dobles.consultorio, logoKey: null };
    }
  });

  test('Importante 1: dos envíos simultáneos del mismo envío → un solo correo y el hash guardado es el del enlace de ese correo', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [c];
    const id = await crearEnvio(T, c, 'aprobado');
    const resultados = await Promise.all([enviarCorreo(ctx, T, id), enviarCorreo(ctx, T, id), enviarCorreo(ctx, T, id)]);
    // Los perdedores ven un reclamo vivo (`ocupado`) o, si el ganador ya terminó, un envío ya enviado (`omitido`).
    expect(resultados.filter((r) => r.resultado === 'enviado')).toHaveLength(1);
    expect(resultados.filter((r) => r.resultado === 'ocupado' || r.resultado === 'omitido')).toHaveLength(2);
    const correos = await correosA(c.contacto.email!);
    expect(correos).toHaveLength(1);
    const token = /\/r\/([\w-]{43})\?accion=confirma/.exec(correos[0]!.html)?.[1];
    expect(token).toBeDefined();
    expect(await leerEnvio(T, id)).toMatchObject({ estado: 'enviado', token_hash: hashDeToken(token!), reclamado_en: null });
  });

  test('un reclamo vigente de otro impide enviar; uno abandonado (> 5 min) puede retomarse', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [c];
    const id = await crearEnvio(T, c, 'aprobado');
    const reclamar = (intervalo: string) =>
      withTenant(n.appPool, T, (tx) => tx.query(`UPDATE envio SET reclamado_en = now() - interval '${intervalo}', token_hash = 'ajeno' WHERE id = $1`, [id]));
    await reclamar('1 minute');
    expect((await enviarCorreo(ctx, T, id)).resultado).toBe('ocupado');
    expect(await correosA(c.contacto.email!)).toEqual([]);
    await reclamar('10 minutes');
    expect((await enviarCorreo(ctx, T, id)).resultado).toBe('enviado');
    expect(await correosA(c.contacto.email!)).toHaveLength(1);
  });

  test('R6: un envío anulado mientras sale el correo no se pisa a enviado ni a fallido', async () => {
    const T = uuidv7();
    const anular = (id: string) => withTenant(n.appPool, T, (tx) => tx.query("UPDATE envio SET estado = 'anulado', token_hash = NULL WHERE id = $1", [id]));
    const c1 = nuevaCita();
    const c2 = nuevaCita();
    n.dobles.citas = [c1, c2];
    const id1 = await crearEnvio(T, c1, 'aprobado');
    const id2 = await crearEnvio(T, c2, 'aprobado');
    const anulaYEnvia = {
      enviar: async () => {
        await anular(id1);
      },
    };
    expect(await enviarCorreo({ ...ctx, puertos: { ...ctx.puertos, correo: anulaYEnvia } }, T, id1)).toEqual({ resultado: 'enviado', estado: 'anulado', intentos: 0 });
    expect((await leerEnvio(T, id1)).estado).toBe('anulado');
    const anulaYFalla = {
      enviar: async () => {
        await anular(id2);
        throw new Error('caído');
      },
    };
    expect((await enviarCorreo({ ...ctx, puertos: { ...ctx.puertos, correo: anulaYFalla } }, T, id2)).resultado).toBe('fallido');
    expect(await leerEnvio(T, id2)).toMatchObject({ estado: 'anulado', intentos: 0 });
  });

  test('si el almacén falla al leer el logo el correo sale sin logo y se avisa con ids', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [c];
    n.dobles.consultorio = { ...n.dobles.consultorio, logoKey: `logos/${T}/roto.png` };
    const id = await crearEnvio(T, c, 'aprobado');
    try {
      const almacen = {
        leer: async () => {
          throw new Error('S3 caído');
        },
      };
      expect((await enviarCorreo({ ...ctx, puertos: { ...ctx.puertos, almacen } }, T, id)).resultado).toBe('enviado');
    } finally {
      n.dobles.consultorio = { ...n.dobles.consultorio, logoKey: null };
    }
    expect((await correosA(c.contacto.email!))[0]?.html).not.toContain('cid:logo');
    expect(lineasLog.some((l) => l.includes('sin logo') && l.includes(id))).toBe(true);
  });

  test('el correo y los logs no contienen el teléfono del paciente; envio no tiene columnas de contacto', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    n.dobles.citas = [c];
    const ok = await crearEnvio(T, c, 'aprobado');
    expect((await enviarCorreo(ctx, T, ok)).resultado).toBe('enviado');
    const falla = nuevaCita();
    n.dobles.citas = [falla];
    const caido = { ...ctx, puertos: { ...ctx.puertos, correo: crearCanalSmtp({ host: '127.0.0.1', puerto: 1, remitente: 'x@consultorio.test' }) } };
    expect((await enviarCorreo(caido, T, await crearEnvio(T, falla, 'aprobado'))).resultado).toBe('fallido');

    const [correo] = await correosA(c.contacto.email!);
    expect(correo?.html).toContain('Ana Gómez');
    expect(correo?.html).not.toContain(TELEFONO_PACIENTE.slice(-10));
    const logs = lineasLog.join('\n');
    expect(logs).toContain(ok);
    for (const secreto of [TELEFONO_PACIENTE.slice(-10), c.contacto.email!, falla.contacto.email!, 'Ana Gómez']) expect(logs).not.toContain(secreto);
    const columnas = (await n.migrator.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'envio'")).rows.map((f) => f.column_name as string);
    expect(columnas.filter((col) => /tel|mail|contacto|nombre|paciente/i.test(col))).toEqual([]);
  });
});

describe('asegurarEnvios', () => {
  test('crea las filas pendientes de correo, es idempotente y registra el consultorio con su zona', async () => {
    const T = uuidv7();
    n.dobles.consultorio = { ...n.dobles.consultorio, zonaHoraria: 'America/Tijuana' };
    try {
      // 2031-05-03T05:00Z = 2031-05-02 22:00 en Tijuana (PDT): la fecha local es la del 2.
      const c = nuevaCita({ inicio: '2031-05-03T05:00:00.000Z', fin: '2031-05-03T05:30:00.000Z' });
      n.dobles.citas = [c];
      await asegurarEnvios(ctx, T, '2031-05-02', '2031-05-02');
      await asegurarEnvios(ctx, T, '2031-05-02', '2031-05-02');
      const filas = await withTenant(n.appPool, T, async (tx) => (await tx.query("SELECT cita_id, fecha_cita::text AS fecha, canal, estado FROM envio")).rows);
      expect(filas).toEqual([{ cita_id: c.citaId, fecha: '2031-05-02', canal: 'correo', estado: 'pendiente' }]);
      const cons = await withTenant(n.appPool, T, async (tx) => (await tx.query('SELECT zona_horaria FROM consultorio')).rows);
      expect(cons).toEqual([{ zona_horaria: 'America/Tijuana' }]);
    } finally {
      n.dobles.consultorio = { ...n.dobles.consultorio, zonaHoraria: 'America/Mexico_City' };
    }
  });

  test('un envío anulado vuelve a pendiente si la cita regresa a esa fecha (y conserva lo ya enviado)', async () => {
    const T = uuidv7();
    const c = nuevaCita();
    const otra = nuevaCita();
    n.dobles.citas = [c, otra];
    const anulado = await crearEnvio(T, c, 'anulado');
    const enviado = await crearEnvio(T, otra, 'enviado');
    await asegurarEnvios(ctx, T, '2031-05-02', '2031-05-02');
    expect((await leerEnvio(T, anulado)).estado).toBe('pendiente');
    expect((await leerEnvio(T, enviado)).estado).toBe('enviado');
  });
});

describe('corridas', () => {
  test('ultimaCorrida es null sin corridas; registrarCorrida es idempotente y gana la fecha mayor', async () => {
    const T = uuidv7();
    await withTenant(n.appPool, T, async (tx) => {
      expect(await ultimaCorrida(tx, T)).toBeNull();
      await registrarCorrida(tx, T, '2031-05-01');
      await registrarCorrida(tx, T, '2031-05-01');
      await registrarCorrida(tx, T, '2031-05-03');
      await registrarCorrida(tx, T, '2031-05-02');
      expect(await ultimaCorrida(tx, T)).toBe('2031-05-03');
    });
  });
});
