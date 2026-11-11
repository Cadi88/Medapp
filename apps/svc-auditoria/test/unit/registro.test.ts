import { canonicalJson, sha256Hex } from '@consultorio/platform';
import { describe, expect, test } from 'vitest';
import {
  HASH_GENESIS,
  calcularHash,
  construirRegistro,
  recursoIdDe,
  registroDesdeFila,
  servicioDe,
  type FilaAuditoria,
} from '../../src/registro.js';

const T = '0194a1b2-0000-7000-8000-000000000001';
const U = '0194a1b2-0000-7000-8000-000000000002';
const E = '0194a1b2-0000-7000-8000-000000000003';

const evento = (over: Record<string, unknown> = {}) => ({
  event_id: E,
  type: 'usuario.vinculado',
  version: 1,
  tenant_id: T,
  actor_id: U,
  occurred_at: '2026-03-04T05:06:07.089Z',
  trace_id: 'tr',
  data: { usuarioId: U, rol: 'medico' } as unknown,
  ...over,
});

describe('HASH_GENESIS', () => {
  test('son 64 ceros', () => expect(HASH_GENESIS).toBe('0'.repeat(64)));
});

describe('servicioDe', () => {
  test.each([
    ['tenant.creado', 'identidad'],
    ['usuario.vinculado', 'identidad'],
    ['medico.actualizado', 'identidad'],
    ['cita.agendada', 'desconocido'],
    ['sinpunto', 'desconocido'],
  ])('%s → %s', (type, esperado) => expect(servicioDe(type)).toBe(esperado));
});

describe('recursoIdDe', () => {
  test('prefiere <prefijo>Id', () => {
    expect(recursoIdDe('tenant', { adminUsuarioId: 'a', tenantId: 't' })).toBe('t');
  });
  test('sin <prefijo>Id usa el primer campo *Id en orden alfabético', () => {
    expect(recursoIdDe('medico', { zId: 'z', usuarioId: 'u', cedula: 'x' })).toBe('u');
    expect(recursoIdDe('medico', { zonaId: 'z', aId: 'a' })).toBe('a');
  });
  test('es independiente del orden de inserción', () => {
    expect(recursoIdDe('x', { bId: '2', aId: '1' })).toBe(recursoIdDe('x', { aId: '1', bId: '2' }));
  });
  test('ignora valores que no son string o están vacíos', () => {
    expect(recursoIdDe('x', { aId: 1, bId: '', cId: 'c' })).toBe('c');
  });
  test('null si no hay campo *Id o data no es un objeto', () => {
    expect(recursoIdDe('x', { nombre: 'n' })).toBeNull();
    expect(recursoIdDe('x', null)).toBeNull();
    expect(recursoIdDe('x', 'texto')).toBeNull();
    expect(recursoIdDe('x', [{ aId: 'a' }])).toBeNull();
    expect(recursoIdDe('x', undefined)).toBeNull();
  });
  test('"Id" a secas no cuenta como campo *Id', () => {
    expect(recursoIdDe('x', { Id: 'a' })).toBeNull();
  });
});

describe('construirRegistro', () => {
  test('mapea el evento a columnas con serialización fija', () => {
    const r = construirRegistro(evento(), 7n, 'h'.repeat(64));
    expect(r).toEqual({
      id: E,
      tenant_id: T,
      secuencia: '7',
      ocurrido_en: '2026-03-04T05:06:07.089Z',
      actor_id: U,
      accion: 'usuario.vinculado',
      recurso_tipo: 'usuario',
      recurso_id: U,
      servicio: 'identidad',
      detalle: { usuarioId: U, rol: 'medico' },
      hash_anterior: 'h'.repeat(64),
    });
  });
  test('normaliza occurred_at con offset a ISO UTC con milisegundos', () => {
    expect(construirRegistro(evento({ occurred_at: '2026-03-04T00:06:07-05:00' }), 1n, HASH_GENESIS).ocurrido_en).toBe('2026-03-04T05:06:07.000Z');
  });
  test('actor nulo, data ausente → detalle null y recurso nulo; type desconocido', () => {
    const r = construirRegistro(evento({ actor_id: null, data: undefined, type: 'cita.agendada' }), 1n, HASH_GENESIS);
    expect(r).toMatchObject({ actor_id: null, detalle: null, recurso_id: null, recurso_tipo: 'cita', servicio: 'desconocido' });
  });
  test('type sin punto usa el type completo como recurso_tipo', () => {
    expect(construirRegistro(evento({ type: 'raro' }), 1n, HASH_GENESIS).recurso_tipo).toBe('raro');
  });
});

describe('calcularHash', () => {
  test('= sha256(hashAnterior + canonicalJson(registro))', () => {
    const r = construirRegistro(evento(), 1n, HASH_GENESIS);
    expect(calcularHash(HASH_GENESIS, r)).toBe(sha256Hex(HASH_GENESIS + canonicalJson(r)));
    expect(calcularHash(HASH_GENESIS, r)).toMatch(/^[0-9a-f]{64}$/);
  });
  test('cualquier cambio en el registro o en el hash previo cambia el hash', () => {
    const r = construirRegistro(evento(), 1n, HASH_GENESIS);
    const base = calcularHash(HASH_GENESIS, r);
    expect(calcularHash('1'.repeat(64), r)).not.toBe(base);
    expect(calcularHash(HASH_GENESIS, { ...r, detalle: {} })).not.toBe(base);
    expect(calcularHash(HASH_GENESIS, { ...r, secuencia: '2' })).not.toBe(base);
  });
});

describe('registroDesdeFila (lo leído de Postgres)', () => {
  const r = construirRegistro(evento(), 12345678901234567890n, HASH_GENESIS);
  // Lo que devuelve node-postgres: timestamptz → Date, bigint → string, jsonb → objeto con otro orden de claves.
  const fila: FilaAuditoria = {
    id: r.id,
    tenant_id: r.tenant_id,
    secuencia: '12345678901234567890',
    ocurrido_en: new Date('2026-03-04T05:06:07.089Z'),
    actor_id: r.actor_id,
    accion: r.accion,
    recurso_tipo: r.recurso_tipo,
    recurso_id: r.recurso_id,
    servicio: r.servicio,
    detalle: { rol: 'medico', usuarioId: U },
    hash_anterior: r.hash_anterior,
    hash: 'x',
  };
  test('construir-para-insertar y construir-desde-fila dan JSON canónico idéntico byte a byte', () => {
    expect(canonicalJson(registroDesdeFila(fila))).toBe(canonicalJson(r));
    expect(calcularHash(HASH_GENESIS, registroDesdeFila(fila))).toBe(calcularHash(HASH_GENESIS, r));
  });
  test('secuencia number/bigint y fecha string se normalizan igual', () => {
    expect(registroDesdeFila({ ...fila, secuencia: 5 }).secuencia).toBe('5');
    expect(registroDesdeFila({ ...fila, secuencia: 5n }).secuencia).toBe('5');
    expect(registroDesdeFila({ ...fila, ocurrido_en: '2026-03-04T05:06:07.089Z' }).ocurrido_en).toBe('2026-03-04T05:06:07.089Z');
  });
  test('no incluye el hash propio', () => {
    expect(registroDesdeFila(fila)).not.toHaveProperty('hash');
  });
});

describe('UUID en mayúsculas (Postgres devuelve uuid en minúsculas)', () => {
  test('el registro construido del sobre y el leído de la fila dan JSON canónico idéntico', () => {
    const up = (s: string) => s.toUpperCase();
    const e = evento({ event_id: up(E), tenant_id: up(T), actor_id: up(U) });
    const r = construirRegistro(e, 1n, HASH_GENESIS);
    const fila: FilaAuditoria = {
      ...registroDesdeFila({ ...r, ocurrido_en: r.ocurrido_en, hash: 'x', id: E, tenant_id: T, actor_id: U }),
      ocurrido_en: new Date(r.ocurrido_en),
      hash: 'x',
    };
    expect(r.id).toBe(E);
    expect(r.tenant_id).toBe(T);
    expect(r.actor_id).toBe(U);
    expect(canonicalJson(registroDesdeFila(fila))).toBe(canonicalJson(r));
    expect(registroDesdeFila({ ...fila, id: up(E), tenant_id: up(T), actor_id: up(U) })).toEqual(registroDesdeFila(fila));
  });
  test('recurso_id (columna text) se conserva tal cual', () => {
    expect(construirRegistro(evento({ data: { usuarioId: U.toUpperCase() } }), 1n, HASH_GENESIS).recurso_id).toBe(U.toUpperCase());
  });
});
