import { jetstream } from '@nats-io/jetstream';
import { MiembroActualizado, TenantCreado, TenantCreadoV1, UsuarioDesvinculado, UsuarioVinculado, UsuarioVinculadoV1 } from '@consultorio/contracts';
import { withTenant } from '@consultorio/platform';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { iniciarConsumidor } from '../../src/consumidor.js';
import { iniciarAgenda, type Agenda } from './helpers.js';

let ag: Agenda;
let consumidor: { stop(): Promise<void> };

beforeAll(async () => {
  ag = await iniciarAgenda();
  consumidor = await iniciarConsumidor({ pool: ag.appPool, nc: ag.nc });
});
afterAll(async () => {
  await consumidor.stop();
  await ag.stop();
});

const publicar = (e: { type: string }) => jetstream(ag.nc).publish(`evt.${e.type}`, JSON.stringify(e));

async function esperar<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > fin) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const medicos = (t: string) => withTenant(ag.appPool, t, async (tx) => (await tx.query('SELECT usuario_id, nombre, activo FROM medico ORDER BY nombre')).rows);
const consultorios = (t: string) => withTenant(ag.appPool, t, async (tx) => (await tx.query('SELECT * FROM consultorio')).rows);
const base = (t: string) => ({ tenantId: t, actorId: null, traceId: 'trace-prueba' });

describe('consumidor de agenda', () => {
  test('tenant.creado + usuario.vinculado v2 crean consultorio y médico; la reentrega es idempotente', async () => {
    const T = uuidv7();
    const u = uuidv7();
    const r = uuidv7();
    const creado = TenantCreado.create({ ...base(T), data: { tenantId: T, nombre: 'C', slug: 'c-1', zonaHoraria: 'America/Mexico_City', adminUsuarioId: u, pais: 'MX', moneda: 'MXN' } });
    const vinculado = UsuarioVinculado.create({ ...base(T), data: { usuarioId: u, nombre: 'Dra. A', rol: 'medico', admin: true } });
    await publicar(creado);
    await publicar(creado);
    await publicar(vinculado);
    await publicar(vinculado);
    // Recepción al final: cuando existe su desactivación pendiente de aplicar, lo anterior ya se procesó.
    await publicar(UsuarioVinculado.create({ ...base(T), data: { usuarioId: r, nombre: 'Rita', rol: 'recepcion', admin: false } }));
    await publicar(UsuarioDesvinculado.create({ ...base(T), data: { usuarioId: r } }));
    await esperar(() => medicos(T), (f) => f.length >= 1);
    expect(await esperar(() => consultorios(T), (f) => f.length >= 1)).toEqual([{ tenant_id: T, zona_horaria: 'America/Mexico_City' }]);
    // Barrera: un evento posterior de otro médico ya procesado implica que los duplicados anteriores también.
    const b = uuidv7();
    await publicar(UsuarioVinculado.create({ ...base(T), data: { usuarioId: b, nombre: 'Zeta', rol: 'medico', admin: false } }));
    const filas = await esperar(() => medicos(T), (f) => f.length >= 2);
    expect(filas).toEqual([
      { usuario_id: u, nombre: 'Dra. A', activo: true },
      { usuario_id: b, nombre: 'Zeta', activo: true },
    ]);
    expect(await consultorios(T)).toHaveLength(1);
  });

  test('consumidor acepta tenant.creado v1 y v2', async () => {
    const [T1, T2] = [uuidv7(), uuidv7()];
    const u = uuidv7();
    const datos = (t: string, zona: string) => ({ tenantId: t, nombre: 'C', slug: 'c-' + t.slice(-6), zonaHoraria: zona, adminUsuarioId: u });
    await publicar(TenantCreadoV1.create({ ...base(T1), data: datos(T1, 'America/Cancun') }));
    await publicar(TenantCreado.create({ ...base(T2), data: { ...datos(T2, 'America/Tijuana'), pais: 'MX', moneda: 'MXN' } }));
    expect(await esperar(() => consultorios(T1), (f) => f.length === 1)).toEqual([{ tenant_id: T1, zona_horaria: 'America/Cancun' }]);
    expect(await esperar(() => consultorios(T2), (f) => f.length === 1)).toEqual([{ tenant_id: T2, zona_horaria: 'America/Tijuana' }]);
  });

  test('miembro.actualizado cambia el nombre y, al pasar a recepción, desactiva', async () => {
    const T = uuidv7();
    const u = uuidv7();
    await publicar(UsuarioVinculado.create({ ...base(T), data: { usuarioId: u, nombre: 'Vieja', rol: 'medico', admin: false } }));
    await esperar(() => medicos(T), (f) => f.length === 1);
    await publicar(MiembroActualizado.create({ ...base(T), data: { usuarioId: u, nombre: 'Nueva', rol: 'medico', admin: false } }));
    expect(await esperar(() => medicos(T), (f) => f[0]?.nombre === 'Nueva')).toEqual([{ usuario_id: u, nombre: 'Nueva', activo: true }]);
    await publicar(MiembroActualizado.create({ ...base(T), data: { usuarioId: u, nombre: 'Nueva', rol: 'recepcion', admin: false } }));
    expect(await esperar(() => medicos(T), (f) => f[0]?.activo === false)).toEqual([{ usuario_id: u, nombre: 'Nueva', activo: false }]);
  });

  test('usuario.desvinculado desactiva sin borrar', async () => {
    const T = uuidv7();
    const u = uuidv7();
    await publicar(UsuarioVinculado.create({ ...base(T), data: { usuarioId: u, nombre: 'Dr. B', rol: 'medico', admin: false } }));
    await esperar(() => medicos(T), (f) => f.length === 1);
    await publicar(UsuarioDesvinculado.create({ ...base(T), data: { usuarioId: u } }));
    expect(await esperar(() => medicos(T), (f) => f[0]?.activo === false)).toEqual([{ usuario_id: u, nombre: 'Dr. B', activo: false }]);
  });

  test('usuario.vinculado v1 con rol admin crea médico con nombre vacío hasta el siguiente miembro.actualizado', async () => {
    const T = uuidv7();
    const u = uuidv7();
    await publicar(UsuarioVinculadoV1.create({ ...base(T), data: { usuarioId: u, rol: 'admin' } }));
    expect(await esperar(() => medicos(T), (f) => f.length === 1)).toEqual([{ usuario_id: u, nombre: '', activo: true }]);
    await publicar(MiembroActualizado.create({ ...base(T), data: { usuarioId: u, nombre: 'Dra. Admin', rol: 'medico', admin: true } }));
    expect(await esperar(() => medicos(T), (f) => f[0]?.nombre === 'Dra. Admin')).toEqual([{ usuario_id: u, nombre: 'Dra. Admin', activo: true }]);
  });

  test('usuario.vinculado v1 con rol recepcion no crea médico', async () => {
    const T = uuidv7();
    const medico = uuidv7();
    await publicar(UsuarioVinculadoV1.create({ ...base(T), data: { usuarioId: uuidv7(), rol: 'recepcion' } }));
    await publicar(UsuarioVinculadoV1.create({ ...base(T), data: { usuarioId: medico, rol: 'medico' } }));
    expect(await esperar(() => medicos(T), (f) => f.length >= 1)).toEqual([{ usuario_id: medico, nombre: '', activo: true }]);
  });
});
