import { withTenant } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  activarTotpEIniciarSesion,
  agregarMiembro,
  conToken,
  crearConsultorio,
  iniciarSesion,
  pedirToken,
  prepararBase,
  servidor,
  type Consultorio,
  type Entorno,
} from './helpers.js';

let env: Entorno;
let app: FastifyInstance;
let c: Consultorio;
let otro: Consultorio;
let medicoId: string;
let medico2Id: string;
let recepcionId: string;
let medicoToken: string;

const q = async (sql: string, params: unknown[] = []) => (await env.migrator.query(sql, params)).rows;
/** Tablas con RLS FORCE: se consultan dentro del tenant, como el rol de aplicación. */
const qt = async (tenantId: string, sql: string, params: unknown[] = []) => (await withTenant(env.appPool, tenantId, (tx) => tx.query(sql, params))).rows;
const putPerfil = (token: string, id: string, payload: unknown) =>
  app.inject({ method: 'PUT', url: `/medicos/${id}/perfil`, payload: payload as object, headers: conToken(token) });
const putFiscales = (token: string, payload: unknown) =>
  app.inject({ method: 'PUT', url: '/datos-fiscales', payload: payload as object, headers: conToken(token) });
const tokenMfa = async (email: string, tenantId: string) => {
  const { cookie } = await activarTotpEIniciarSesion(app, email);
  return (await pedirToken(app, cookie, tenantId)).json<{ token: string }>().token;
};

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
  c = await crearConsultorio(app, 'perfil-uno');
  otro = await crearConsultorio(app, 'perfil-otro');
  medicoId = await agregarMiembro(app, c, 'medico@perfil.mx', 'medico');
  medico2Id = await agregarMiembro(app, c, 'medico2@perfil.mx', 'medico');
  recepcionId = await agregarMiembro(app, c, 'recep@perfil.mx', 'recepcion');
  medicoToken = await tokenMfa('medico@perfil.mx', c.tenantId);
});
afterAll(async () => {
  await app.close();
  await env.stop();
});

describe('PUT /medicos/:usuarioId/perfil', () => {
  const perfil = { cedulaProfesional: '1234567', especialidad: 'Cardiología', cedulaEspecialidad: '7654321', institucion: 'UNAM' };

  test('el propio médico guarda su perfil (upsert) y se emite medico.actualizado', async () => {
    const r = await putPerfil(medicoToken, medicoId, perfil);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ usuarioId: medicoId, cedulaProfesional: '1234567', especialidad: 'Cardiología' });
    expect(await qt(c.tenantId, 'select cedula_profesional, especialidad, cedula_especialidad, institucion from perfil_medico where usuario_id = $1', [medicoId])).toEqual([
      { cedula_profesional: '1234567', especialidad: 'Cardiología', cedula_especialidad: '7654321', institucion: 'UNAM' },
    ]);
    const ev = (await q("select payload from outbox where type = 'medico.actualizado' and tenant_id = $1", [c.tenantId])).map((x) => x.payload).at(-1);
    expect(ev).toMatchObject({
      actor_id: medicoId,
      trace_id: r.headers['x-trace-id'],
      data: { usuarioId: medicoId, cedulaProfesional: '1234567', especialidad: 'Cardiología' },
    });
  });

  test('el admin edita el perfil de un médico; una segunda llamada reemplaza (no duplica)', async () => {
    expect((await putPerfil(c.adminToken, medico2Id, perfil)).statusCode).toBe(200);
    const r = await putPerfil(c.adminToken, medico2Id, { cedulaProfesional: '87654321' });
    expect(r.statusCode).toBe(200);
    const filas = await qt(c.tenantId, 'select cedula_profesional, especialidad, institucion from perfil_medico where usuario_id = $1', [medico2Id]);
    expect(filas).toEqual([{ cedula_profesional: '87654321', especialidad: null, institucion: null }]);
    const ev = (await q("select payload from outbox where type = 'medico.actualizado' and payload->'data'->>'usuarioId' = $1", [medico2Id])).map((x) => x.payload);
    expect(ev.at(-1)).toMatchObject({ actor_id: c.adminId, data: { cedulaProfesional: '87654321', especialidad: '' } });
  });

  test('un médico no puede editar el perfil de otro → 403 PROHIBIDO', async () => {
    const r = await putPerfil(medicoToken, medico2Id, perfil);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('PROHIBIDO');
  });

  test('recepción → 403', async () => {
    const token = (await pedirToken(app, await iniciarSesion(app, 'recep@perfil.mx'), c.tenantId)).json().token;
    expect((await putPerfil(token, medicoId, perfil)).statusCode).toBe(403);
    expect((await putPerfil(token, recepcionId, perfil)).statusCode).toBe(403);
  });

  test('sin token → 401', async () => {
    const r = await app.inject({ method: 'PUT', url: `/medicos/${medicoId}/perfil`, payload: perfil });
    expect(r.statusCode).toBe(401);
  });

  test.each([['123456'], ['123456789'], ['ABC1234'], [1234567], [undefined]])('cédula %j inválida → 400 VALIDACION', async (cedulaProfesional) => {
    const r = await putPerfil(c.adminToken, medicoId, { ...perfil, cedulaProfesional });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('VALIDACION');
  });

  test('id de ruta que no es UUID → 400', async () => {
    expect((await putPerfil(c.adminToken, 'no-uuid', perfil)).statusCode).toBe(400);
  });

  test('médico de otro consultorio → 404 NO_ENCONTRADO', async () => {
    const ajeno = await agregarMiembro(app, otro, 'medico@otro.mx', 'medico');
    const r = await putPerfil(c.adminToken, ajeno, perfil);
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe('NO_ENCONTRADO');
    expect(await qt(otro.tenantId, 'select 1 from perfil_medico where usuario_id = $1', [ajeno])).toHaveLength(0);
  });

  test('un miembro que no es médico (admin, recepción) o un id desconocido → 404', async () => {
    for (const id of [c.adminId, recepcionId, '0190aaaa-0000-7000-8000-000000000099']) {
      const r = await putPerfil(c.adminToken, id, perfil);
      expect(r.statusCode).toBe(404);
    }
  });
});

describe('PUT /datos-fiscales', () => {
  const fiscales = { rfc: 'xaxx010101000', razonSocial: 'Clínica del Valle SA de CV', regimenFiscal: '601', cp: '06600' };

  test('admin guarda datos fiscales: RFC en mayúsculas y upsert', async () => {
    const r = await putFiscales(c.adminToken, fiscales);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ rfc: 'XAXX010101000', razonSocial: 'Clínica del Valle SA de CV', regimenFiscal: '601', cp: '06600' });
    const r2 = await putFiscales(c.adminToken, { ...fiscales, razonSocial: 'Otra Razón', cp: '11000' });
    expect(r2.statusCode).toBe(200);
    const filas = await qt(c.tenantId, 'select rfc, razon_social, regimen_fiscal, cp, pac_emisor_id from datos_fiscales');
    expect(filas).toEqual([{ rfc: 'XAXX010101000', razon_social: 'Otra Razón', regimen_fiscal: '601', cp: '11000', pac_emisor_id: null }]);
  });

  test('conserva el id del PAC ya configurado', async () => {
    await qt(c.tenantId, "update datos_fiscales set pac_emisor_id = 'pac-123'");
    expect((await putFiscales(c.adminToken, fiscales)).statusCode).toBe(200);
    expect((await qt(c.tenantId, 'select pac_emisor_id from datos_fiscales'))[0].pac_emisor_id).toBe('pac-123');
  });

  test('cada consultorio tiene los suyos', async () => {
    await putFiscales(otro.adminToken, { ...fiscales, rfc: 'GODE561231GR8', cp: '44100' });
    expect(await qt(c.tenantId, 'select tenant_id, cp from datos_fiscales')).toEqual([{ tenant_id: c.tenantId, cp: '06600' }]);
    expect(await qt(otro.tenantId, 'select tenant_id, cp from datos_fiscales')).toEqual([{ tenant_id: otro.tenantId, cp: '44100' }]);
  });

  test.each([
    ['rfc corto', { rfc: 'XAXX0101' }],
    ['rfc con símbolos', { rfc: 'XAXX01010!000' }],
    ['régimen de 2 dígitos', { regimenFiscal: '60' }],
    ['cp de 4 dígitos', { cp: '0660' }],
    ['razón social vacía', { razonSocial: '' }],
  ])('%s → 400 VALIDACION', async (_n, cambio) => {
    const r = await putFiscales(c.adminToken, { ...fiscales, ...cambio });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('VALIDACION');
  });

  test('RFC inválido → 400 VALIDACION', async () => {
    const r = await putFiscales(c.adminToken, { ...fiscales, rfc: 'NO-ES-RFC' });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('VALIDACION');
  });

  test('médico y recepción → 403', async () => {
    expect((await putFiscales(medicoToken, fiscales)).statusCode).toBe(403);
  });

  test('sin token → 401', async () => {
    expect((await app.inject({ method: 'PUT', url: '/datos-fiscales', payload: fiscales })).statusCode).toBe(401);
  });
});
