import { withTenant } from '@consultorio/platform';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { consultorioSchema, miembrosRespuestaSchema } from '@consultorio/contracts';
import { agregarMiembro, conToken, crearConsultorio, prepararBase, servidor, tokenDe, type Consultorio, type Entorno } from './helpers.js';

let env: Entorno;
let app: FastifyInstance;
let c: Consultorio;
let recepcionId: string;
let tokenRecepcion: string;
/** Tablas con RLS FORCE: se consultan dentro del tenant, como el rol de aplicación. */
const qt = async (tenantId: string, sql: string, params: unknown[] = []) => (await withTenant(env.appPool, tenantId, (tx) => tx.query(sql, params))).rows;
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, ...(token ? { headers: conToken(token) } : {}) });

beforeAll(async () => {
  env = await prepararBase();
  app = await servidor(env);
  c = await crearConsultorio(app, 'lectura-uno');
  const otro = await crearConsultorio(app, 'lectura-dos');
  recepcionId = await agregarMiembro(app, c, 'zeta-recepcion@lectura.mx', 'recepcion');
  await agregarMiembro(app, otro, 'ajeno@lectura.mx', 'recepcion');
  tokenRecepcion = await tokenDe(app, 'zeta-recepcion@lectura.mx', c.tenantId, { mfa: false });
});
afterAll(async () => {
  await app.close();
  await env.stop();
});

describe('GET /consultorio', () => {
  test('devuelve el consultorio del token con su zona horaria, a cualquier miembro', async () => {
    for (const t of [c.adminToken, tokenRecepcion]) {
      const r = await get('/consultorio', t);
      expect(r.statusCode).toBe(200);
      expect(consultorioSchema.parse(r.json())).toEqual({
        id: c.tenantId,
        nombre: 'Consultorio lectura-uno',
        slug: 'lectura-uno',
        zonaHoraria: 'America/Mexico_City',
        nombreComercial: null,
        direccion: null,
        telefono: null,
        colorPrimario: null,
        colorTexto: null,
        logoVersion: 0,
        pais: 'MX',
        moneda: 'MXN',
      });
    }
  });
  test('con color y logo guardados: colorTexto calculado y logoVersion; sin logo_key la versión es 0', async () => {
    await env.migrator.query("UPDATE tenant SET color_primario = '#fde68a', logo_version = 4 WHERE id = $1", [c.tenantId]);
    let r = consultorioSchema.parse((await get('/consultorio', c.adminToken)).json());
    expect(r).toMatchObject({ colorPrimario: '#fde68a', colorTexto: '#000000', logoVersion: 0 });
    await env.migrator.query("UPDATE tenant SET color_primario = '#1e3a8a', logo_key = 'logos/x/y.png' WHERE id = $1", [c.tenantId]);
    r = consultorioSchema.parse((await get('/consultorio', c.adminToken)).json());
    expect(r).toMatchObject({ colorPrimario: '#1e3a8a', colorTexto: '#ffffff', logoVersion: 4 });
    await env.migrator.query('UPDATE tenant SET color_primario = NULL, logo_key = NULL, logo_version = 0 WHERE id = $1', [c.tenantId]);
  });
  test('sin token → 401', async () => {
    expect((await get('/consultorio')).statusCode).toBe(401);
  });
});

describe('GET /miembros', () => {
  test('lista solo los del consultorio, ordenados por nombre, con perfil médico y banderas', async () => {
    await qt(
      c.tenantId,
      `INSERT INTO perfil_medico (tenant_id, usuario_id, cedula_profesional, especialidad) VALUES ($1, $2, '1234567', 'Pediatría')
       ON CONFLICT (tenant_id, usuario_id) DO UPDATE SET cedula_profesional = '1234567', especialidad = 'Pediatría'`,
      [c.tenantId, c.adminId],
    );
    await env.migrator.query('UPDATE "user" SET "debeCambiarPassword" = true WHERE id = $1', [recepcionId]);
    const r = await get('/miembros', c.adminToken);
    await env.migrator.query('UPDATE "user" SET "debeCambiarPassword" = false WHERE id = $1', [recepcionId]);
    expect(r.statusCode).toBe(200);
    const { miembros } = miembrosRespuestaSchema.parse(r.json());
    expect(miembros.map((m) => m.email).sort()).toEqual(['admin-lectura-uno@ejemplo.mx', 'zeta-recepcion@lectura.mx']);
    const nombres = miembros.map((m) => m.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b)));
    expect(miembros.find((m) => m.usuarioId === c.adminId)).toMatchObject({
      rol: 'medico',
      admin: true,
      mfaActivo: true,
      debeCambiarPassword: false,
      perfilMedico: { cedulaProfesional: '1234567', especialidad: 'Pediatría', cedulaEspecialidad: null, institucion: null },
    });
    expect(miembros.find((m) => m.usuarioId === recepcionId)).toMatchObject({
      rol: 'recepcion',
      admin: false,
      mfaActivo: false,
      debeCambiarPassword: true,
      perfilMedico: null,
    });
  });
  test('lo puede leer cualquier miembro (recepción)', async () => {
    expect((await get('/miembros', tokenRecepcion)).statusCode).toBe(200);
  });
});
