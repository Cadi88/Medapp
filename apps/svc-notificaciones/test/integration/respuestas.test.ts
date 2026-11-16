import type { CitaParaRecordatorio } from '@consultorio/contracts';
import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { generarToken } from '../../src/dominio/token.js';
import { iniciarNotificaciones, type Notificaciones } from './helpers.js';

let n: Notificaciones;
let T: string;
const ahora = new Date('2030-01-07T17:00:00.000Z');
const INICIO = '2030-01-08T15:00:00.000Z';

beforeAll(async () => {
  n = await iniciarNotificaciones({ reloj: () => ahora });
}, 180_000);
afterAll(async () => {
  await n?.stop();
});
beforeEach(() => {
  T = uuidv7();
  n.dobles.citas = [];
});

const cita = (): CitaParaRecordatorio => ({
  citaId: uuidv7(),
  version: 1,
  inicio: INICIO,
  fin: '2030-01-08T15:30:00.000Z',
  estado: 'agendada',
  pideCambio: false,
  medicoId: uuidv7(),
  medicoNombre: 'Dra. Ruiz',
  tipoCitaNombre: 'Consulta',
  contacto: { nombre: 'Ana López', telefono: '5599990000', email: 'ana@paciente.test' },
});

/** Envío ya enviado con un token conocido (lo que deja `enviarCorreo`). */
async function sembrar(o: { estado?: string; expira?: string | null; respuesta?: string | null; sinToken?: boolean } = {}): Promise<{ token: string; citaId: string; envioId: string; cita: CitaParaRecordatorio }> {
  const c = cita();
  n.dobles.citas = [c];
  const { token, hash } = generarToken();
  const envioId = uuidv7();
  await withTenant(n.appPool, T, async (tx) => {
    await tx.query(
      `INSERT INTO envio (id, tenant_id, cita_id, fecha_cita, canal, estado, token_hash, token_expira_en, respuesta, respondido_en, respondido_por)
       VALUES ($1, $2, $3, '2030-01-08', 'correo', $4, $5, $6, $7, $8, $9)`,
      [envioId, T, c.citaId, o.estado ?? 'enviado', o.sinToken ? null : hash, o.expira === undefined ? INICIO : o.expira, o.respuesta ?? null, o.respuesta ? ahora : null, o.respuesta ? 'paciente' : null],
    );
  });
  return { token, citaId: c.citaId, envioId, cita: c };
}

const get = async (token: string) => {
  const r = await n.app.inject({ method: 'GET', url: `/respuestas/${token}` });
  return { status: r.statusCode, cuerpo: JSON.parse(r.body) as Record<string, unknown>, texto: r.body };
};
const post = async (token: string, payload: unknown = { respuesta: 'confirma' }) => {
  const r = await n.app.inject({ method: 'POST', url: `/respuestas/${token}`, payload: payload as object });
  return { status: r.statusCode, cuerpo: JSON.parse(r.body) as Record<string, unknown> };
};
const eventos = async () => (await n.migrator.query<{ payload: Record<string, unknown> }>("SELECT payload FROM outbox WHERE type = 'cita.respuesta_paciente' AND tenant_id = $1", [T])).rows.map((r) => r.payload);
const envio = (id: string) => withTenant(n.appPool, T, async (tx) => (await tx.query('SELECT * FROM envio WHERE id = $1', [id])).rows[0] as Record<string, unknown>);

describe('GET /respuestas/:token (pública)', () => {
  test('vigente: datos del consultorio y de la cita, sin datos de contacto del paciente; no pide JWT', async () => {
    const s = await sembrar();
    const r = await get(s.token);
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({
      estado: 'vigente',
      consultorio: { nombre: 'Consultorio de prueba', tieneLogo: false },
      fecha: 'martes 8 de enero',
      hora: '09:00',
      medico: 'Dra. Ruiz',
      telefonoConsultorio: '5512345678',
    });
    expect(r.texto).not.toMatch(/Ana|ana@paciente|5599990000/);
    expect((await envio(s.envioId)).respuesta).toBeNull();
  });

  test('con logo el consultorio lo avisa', async () => {
    const original = n.dobles.consultorio;
    n.dobles.consultorio = { ...original, logoKey: 'logos/x/y.png' };
    try {
      const s = await sembrar();
      expect((await get(s.token)).cuerpo.consultorio).toEqual({ nombre: 'Consultorio de prueba', tieneLogo: true });
    } finally {
      n.dobles.consultorio = original;
    }
  });

  test('token inválido, anulado, vencido, de otro estado o de una cita que ya no está → invalida sin más datos', async () => {
    expect((await get('no-existe')).cuerpo).toEqual({ estado: 'invalida' });
    expect((await get('x'.repeat(90))).cuerpo).toEqual({ estado: 'invalida' });

    const anulado = await sembrar({ estado: 'anulado', sinToken: true });
    expect((await get(anulado.token)).cuerpo).toEqual({ estado: 'invalida' });

    const sinEnviar = await sembrar({ estado: 'aprobado' });
    expect((await get(sinEnviar.token)).cuerpo).toEqual({ estado: 'invalida' });

    const vencido = await sembrar({ expira: '2030-01-07T16:59:59.000Z' });
    expect((await get(vencido.token)).cuerpo).toEqual({ estado: 'invalida' });

    const sinFecha = await sembrar({ expira: null });
    expect((await get(sinFecha.token)).cuerpo).toEqual({ estado: 'invalida' });

    const huerfana = await sembrar();
    n.dobles.citas = [];
    expect((await get(huerfana.token)).cuerpo).toEqual({ estado: 'invalida' });
  });

  test('ya respondida: lo dice y da el teléfono del consultorio, sin datos de la cita', async () => {
    const s = await sembrar({ respuesta: 'confirma' });
    const r = await get(s.token);
    expect(r.cuerpo).toEqual({ estado: 'respondida', consultorio: { nombre: 'Consultorio de prueba', tieneLogo: false }, telefonoConsultorio: '5512345678' });
  });

  test('si el consultorio no tiene teléfono no se incluye', async () => {
    const original = n.dobles.consultorio;
    n.dobles.consultorio = { ...original, telefono: null };
    try {
      const s = await sembrar();
      expect((await get(s.token)).cuerpo).not.toHaveProperty('telefonoConsultorio');
    } finally {
      n.dobles.consultorio = original;
    }
  });
});

describe('POST /respuestas/:token (pública)', () => {
  test('dos veces → registrada y luego respondida; emite un solo evento con origen paciente y actor null', async () => {
    const s = await sembrar();
    const a = await post(s.token, { respuesta: 'cancela' });
    expect(a).toEqual({ status: 200, cuerpo: { estado: 'registrada' } });
    expect(await envio(s.envioId)).toMatchObject({ respuesta: 'cancela', respondido_por: 'paciente' });
    expect((await post(s.token, { respuesta: 'confirma' })).cuerpo).toEqual({ estado: 'respondida' });
    expect((await envio(s.envioId)).respuesta).toBe('cancela');

    const evs = await eventos();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      type: 'cita.respuesta_paciente',
      version: 1,
      tenant_id: T,
      actor_id: null,
      data: { citaId: s.citaId, inicioCita: INICIO, respuesta: 'cancela', canal: 'correo', origen: 'paciente' },
    });
    expect(JSON.stringify(evs)).not.toMatch(/Ana|ana@paciente|5599990000/);
    expect((await get(s.token)).cuerpo.estado).toBe('respondida');
  });

  test('dos simultáneos → uno registrada y el otro respondida', async () => {
    const s = await sembrar();
    const resultados = await Promise.all(Array.from({ length: 6 }, (_, i) => post(s.token, { respuesta: i % 2 === 0 ? 'confirma' : 'cancela' })));
    const estados = resultados.map((r) => r.cuerpo.estado);
    expect(estados.filter((e) => e === 'registrada')).toHaveLength(1);
    expect(estados.filter((e) => e === 'respondida')).toHaveLength(5);
    expect(await eventos()).toHaveLength(1);
  });

  test('token inválido o vencido → invalida y no escribe nada', async () => {
    expect((await post('no-existe')).cuerpo).toEqual({ estado: 'invalida' });
    const vencido = await sembrar({ expira: '2030-01-07T16:59:59.000Z' });
    expect((await post(vencido.token)).cuerpo).toEqual({ estado: 'invalida' });
    const sinEnviar = await sembrar({ estado: 'aprobado' });
    expect((await post(sinEnviar.token)).cuerpo).toEqual({ estado: 'invalida' });
    expect((await envio(vencido.envioId)).respuesta).toBeNull();
    expect(await eventos()).toHaveLength(0);
  });

  test('cuerpo inválido → 400 y el enlace sigue vigente', async () => {
    const s = await sembrar();
    expect((await post(s.token, { respuesta: 'tal vez' })).status).toBe(400);
    expect((await post(s.token, {})).status).toBe(400);
    expect((await get(s.token)).cuerpo.estado).toBe('vigente');
  });
});
