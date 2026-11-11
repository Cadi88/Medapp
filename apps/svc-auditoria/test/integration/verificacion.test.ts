import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { LOCK_VERIFICACION, ejecutarVerificacion } from '../../src/programador.js';
import { verificarCadena } from '../../src/verificacion.js';
import { comoDueno, comoDuenoSinTrigger, leer, prepararBase, registrarN, tenantId, type Entorno } from './helpers.js';

let env: Entorno;
beforeAll(async () => {
  env = await prepararBase();
});
afterAll(async () => {
  await env.stop();
});

describe('verificarCadena', () => {
  test('una cadena sin tocar es válida; un tenant sin eventos también', async () => {
    const A = tenantId();
    await registrarN(env, A, 4);
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: true });
    expect(await verificarCadena(env.appPool, tenantId())).toEqual({ valida: true });
  });

  test('verifica por lotes (varios lotes)', async () => {
    const A = tenantId();
    await registrarN(env, A, 7);
    expect(await verificarCadena(env.appPool, A, { tamanoLote: 3 })).toEqual({ valida: true });
    await comoDueno(env, A, "update evento_auditoria set accion = 'x' where secuencia = 6");
    expect(await verificarCadena(env.appPool, A, { tamanoLote: 3 })).toEqual({ valida: false, rotaEnSecuencia: 6 });
  });

  test('alterar un registro (como dueño de la tabla) rompe la verificación en esa secuencia', async () => {
    const A = tenantId();
    await registrarN(env, A, 3);
    expect(await comoDueno(env, A, "update evento_auditoria set detalle = '{}' where secuencia = 2")).toBe(1);
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: false, rotaEnSecuencia: 2 });
  });

  test('alterar hash_anterior, actor o fecha también se detecta', async () => {
    for (const set of ["actor_id = null", "ocurrido_en = ocurrido_en + interval '1 second'", "recurso_id = 'otro'", "hash_anterior = repeat('a', 64)"]) {
      const A = tenantId();
      await registrarN(env, A, 3);
      await comoDueno(env, A, `update evento_auditoria set ${set} where secuencia = 3`);
      expect(await verificarCadena(env.appPool, A), set).toEqual({ valida: false, rotaEnSecuencia: 3 });
    }
  });

  test('borrar un registro intermedio se detecta en la secuencia faltante', async () => {
    const A = tenantId();
    await registrarN(env, A, 4);
    await comoDueno(env, A, 'delete from evento_auditoria where secuencia = 2');
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: false, rotaEnSecuencia: 2 });
  });

  test('borrar los últimos registros (truncar la cola) se detecta contra el encabezado de la cadena', async () => {
    const A = tenantId();
    await registrarN(env, A, 4);
    await comoDueno(env, A, 'delete from evento_auditoria where secuencia >= 3');
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: false, rotaEnSecuencia: 3 });
  });

  test('borrar todo el historial de un tenant con cadena se detecta en la secuencia 1', async () => {
    const A = tenantId();
    await registrarN(env, A, 2);
    await comoDueno(env, A, 'delete from evento_auditoria');
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: false, rotaEnSecuencia: 1 });
  });

  test('alterar el encabezado de la cadena (ultimo_hash) se detecta en la última secuencia', async () => {
    const A = tenantId();
    await registrarN(env, A, 3);
    await comoDuenoSinTrigger(env, A, "update cadena set ultimo_hash = repeat('b', 64)");
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: false, rotaEnSecuencia: 3 });
  });

  test('F2: encabezado rebajado (saltándose el trigger) → rota en ultima_secuencia + 1 aunque el tramo 1..ultima sea íntegro', async () => {
    const A = tenantId();
    await registrarN(env, A, 4);
    await comoDuenoSinTrigger(
      env,
      A,
      'update cadena set ultima_secuencia = 2, ultimo_hash = (select hash from evento_auditoria e where e.tenant_id = cadena.tenant_id and e.secuencia = 2)',
    );
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: false, rotaEnSecuencia: 3 });
  });

  test('F2: eventos sin fila de encabezado → rota en 1', async () => {
    const A = tenantId();
    await registrarN(env, A, 2);
    expect(await comoDueno(env, A, 'delete from cadena')).toBe(1);
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: false, rotaEnSecuencia: 1 });
  });

  test('F2: encabezado en 0 (reiniciado sin trigger) con eventos → rota en 1', async () => {
    const A = tenantId();
    await registrarN(env, A, 2);
    await comoDuenoSinTrigger(env, A, "update cadena set ultima_secuencia = 0, ultimo_hash = repeat('0', 64)");
    expect(await verificarCadena(env.appPool, A)).toEqual({ valida: false, rotaEnSecuencia: 1 });
  });

  test('la verificación no confunde los datos de otro tenant', async () => {
    const A = tenantId();
    const B = tenantId();
    await registrarN(env, A, 2);
    await registrarN(env, B, 2);
    await comoDueno(env, B, "update evento_auditoria set detalle = '{}' where secuencia = 1");
    expect((await verificarCadena(env.appPool, A)).valida).toBe(true);
    expect(await verificarCadena(env.appPool, B)).toEqual({ valida: false, rotaEnSecuencia: 1 });
  });
});

describe('ejecutarVerificacion (tarea diaria)', () => {
  const logger = () => {
    const l = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    return { l, logger: l as unknown as Logger };
  };

  test('recorre los tenants y alerta solo de las cadenas rotas', async () => {
    const buena = tenantId();
    const mala = tenantId();
    await registrarN(env, buena, 2);
    await registrarN(env, mala, 3);
    await comoDueno(env, mala, "update evento_auditoria set detalle = '{\"x\":1}' where secuencia = 2");
    const { l, logger: log } = logger();
    const r = await ejecutarVerificacion({ pool: env.appPool, logger: log });
    expect(r.ejecutada).toBe(true);
    expect(r.rotas).toBeGreaterThanOrEqual(1);
    const alertas = l.error.mock.calls.filter(([o]) => o.alerta === 'cadena_auditoria_rota').map(([o]) => o);
    expect(alertas).toContainEqual({ alerta: 'cadena_auditoria_rota', tenant_id: mala, secuencia: 2 });
    expect(alertas.some((o) => o.tenant_id === buena)).toBe(false);
  });

  test('F2: un tenant con eventos pero sin encabezado aparece en la lista y se alerta', async () => {
    const huerfano = tenantId();
    await registrarN(env, huerfano, 2);
    await comoDueno(env, huerfano, 'delete from cadena');
    const lista = (await env.appPool.query<{ tenant_id: string }>('select tenant_id from fn_tenants_auditados()')).rows.map((r) => r.tenant_id);
    expect(lista).toContain(huerfano);
    const { l, logger: log } = logger();
    await ejecutarVerificacion({ pool: env.appPool, logger: log });
    const alertas = l.error.mock.calls.filter(([o]) => o.alerta === 'cadena_auditoria_rota').map(([o]) => o);
    expect(alertas).toContainEqual({ alerta: 'cadena_auditoria_rota', tenant_id: huerfano, secuencia: 1 });
  });

  test('solo una réplica a la vez: con el advisory lock tomado por otra conexión no hace nada', async () => {
    const otra = await env.appPool.connect();
    try {
      expect((await otra.query('select pg_try_advisory_lock($1) as ok', [LOCK_VERIFICACION])).rows[0].ok).toBe(true);
      const { logger: log } = logger();
      expect(await ejecutarVerificacion({ pool: env.appPool, logger: log })).toEqual({ ejecutada: false, tenants: 0, rotas: 0 });
    } finally {
      await otra.query('select pg_advisory_unlock($1)', [LOCK_VERIFICACION]);
      otra.release();
    }
    const { logger: log } = logger();
    expect((await ejecutarVerificacion({ pool: env.appPool, logger: log })).ejecutada).toBe(true);
  });

  test('leer sigue funcionando tras todo (sanidad)', async () => {
    expect(Array.isArray(await leer(env, tenantId()))).toBe(true);
  });
});
