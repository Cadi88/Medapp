import { withTenant } from '@consultorio/platform';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { registrar } from '../../src/cadena.js';
import { HASH_GENESIS } from '../../src/registro.js';
import { verificarCadena } from '../../src/verificacion.js';
import { evento, leer, prepararBase, range, registrarN, tenantId, type Entorno } from './helpers.js';

let env: Entorno;
beforeAll(async () => {
  env = await prepararBase();
});
afterAll(async () => {
  await env.stop();
});

describe('registrar', () => {
  test('cada registro encadena con el anterior', async () => {
    const A = tenantId();
    await registrarN(env, A, 3);
    const filas = await leer(env, A);
    expect(filas[0]!.hash_anterior).toBe(HASH_GENESIS);
    expect(filas[1]!.hash_anterior).toBe(filas[0]!.hash);
    expect(filas[2]!.hash_anterior).toBe(filas[1]!.hash);
    expect((await verificarCadena(env.appPool, A)).valida).toBe(true);
  });

  test('mapea el evento a las columnas de auditoría', async () => {
    const A = tenantId();
    const e = evento(A, { type: 'tenant.creado', data: { tenantId: A, nombre: 'Clínica', adminUsuarioId: 'u-1' } });
    await withTenant(env.appPool, A, (tx) => registrar(tx, e));
    const [f] = await leer(env, A);
    expect(f).toMatchObject({
      id: e.event_id,
      tenant_id: A,
      secuencia: '1',
      actor_id: e.actor_id,
      accion: 'tenant.creado',
      recurso_tipo: 'tenant',
      recurso_id: A,
      servicio: 'identidad',
      detalle: e.data,
    });
    expect(new Date(f!.ocurrido_en).toISOString()).toBe(e.occurred_at);
  });

  test('Review Focus 2: 50 eventos concurrentes → secuencias 1..50 sin huecos y cadena válida', async () => {
    const A = tenantId();
    await registrarN(env, A, 1); // la cadena ya existe
    await Promise.all(Array.from({ length: 49 }, () => withTenant(env.appPool, A, (tx) => registrar(tx, evento(A)))));
    expect((await leer(env, A)).map((f) => Number(f.secuencia))).toEqual(range(1, 50));
    expect((await verificarCadena(env.appPool, A)).valida).toBe(true);
  });

  test('50 eventos concurrentes desde cero (cadena aún inexistente) → 1..50 y cadena válida', async () => {
    const A = tenantId();
    await Promise.all(Array.from({ length: 50 }, () => withTenant(env.appPool, A, (tx) => registrar(tx, evento(A)))));
    expect((await leer(env, A)).map((f) => Number(f.secuencia))).toEqual(range(1, 50));
    expect((await verificarCadena(env.appPool, A)).valida).toBe(true);
  });

  test('dos primeros eventos concurrentes de un tenant nuevo → secuencias 1 y 2', async () => {
    for (let i = 0; i < 5; i++) {
      const A = tenantId();
      await Promise.all([withTenant(env.appPool, A, (tx) => registrar(tx, evento(A))), withTenant(env.appPool, A, (tx) => registrar(tx, evento(A)))]);
      expect((await leer(env, A)).map((f) => Number(f.secuencia))).toEqual([1, 2]);
      expect((await verificarCadena(env.appPool, A)).valida).toBe(true);
    }
  });

  test('cadenas independientes por tenant', async () => {
    const A = tenantId();
    const B = tenantId();
    await Promise.all([registrarN(env, A, 3), registrarN(env, B, 2)]);
    expect((await leer(env, A)).map((f) => Number(f.secuencia))).toEqual([1, 2, 3]);
    expect((await leer(env, B)).map((f) => Number(f.secuencia))).toEqual([1, 2]);
    expect((await leer(env, B))[0]!.hash_anterior).toBe(HASH_GENESIS);
  });

  test('si la transacción se revierte no queda hueco: la siguiente toma la misma secuencia', async () => {
    const A = tenantId();
    await registrarN(env, A, 1);
    await expect(
      withTenant(env.appPool, A, async (tx) => {
        await registrar(tx, evento(A));
        throw new Error('falla posterior');
      }),
    ).rejects.toThrow('falla posterior');
    await registrarN(env, A, 1);
    expect((await leer(env, A)).map((f) => Number(f.secuencia))).toEqual([1, 2]);
    expect((await verificarCadena(env.appPool, A)).valida).toBe(true);
  });

  test('un evento repetido (mismo id) falla por la clave primaria y no avanza la cadena', async () => {
    const A = tenantId();
    const e = evento(A);
    await withTenant(env.appPool, A, (tx) => registrar(tx, e));
    await expect(withTenant(env.appPool, A, (tx) => registrar(tx, e))).rejects.toThrow(/duplicate key/);
    expect((await leer(env, A)).length).toBe(1);
  });

  test('un evento de otro tenant que el de la transacción es rechazado por RLS', async () => {
    const A = tenantId();
    const B = tenantId();
    await expect(withTenant(env.appPool, A, (tx) => registrar(tx, evento(B)))).rejects.toThrow(/row-level security|violates/);
  });
});
