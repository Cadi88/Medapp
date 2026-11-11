import { describe, expect, test } from 'vitest';
import { HASH_GENESIS, calcularHash, construirRegistro, type FilaAuditoria } from '../../src/registro.js';
import { verificarLote, type EstadoCadena } from '../../src/verificacion.js';

const T = '0194a1b2-0000-7000-8000-000000000001';

function cadena(n: number): FilaAuditoria[] {
  const filas: FilaAuditoria[] = [];
  let prev = HASH_GENESIS;
  for (let i = 1; i <= n; i++) {
    const reg = construirRegistro(
      {
        event_id: `0194a1b2-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`,
        type: 'usuario.vinculado',
        version: 1,
        tenant_id: T,
        actor_id: null,
        occurred_at: '2026-01-01T00:00:00.000Z',
        trace_id: 't',
        data: { usuarioId: `u${i}` },
      },
      BigInt(i),
      prev,
    );
    const hash = calcularHash(prev, reg);
    filas.push({ ...reg, ocurrido_en: new Date(reg.ocurrido_en), hash });
    prev = hash;
  }
  return filas;
}
const inicio: EstadoCadena = { siguiente: 1n, hash: HASH_GENESIS };

describe('verificarLote', () => {
  test('cadena válida avanza el estado', () => {
    const f = cadena(3);
    const r = verificarLote(inicio, f);
    expect(r.rotaEnSecuencia).toBeUndefined();
    expect(r.estado.siguiente).toBe(4n);
    expect(r.estado.hash).toBe(f[2]!.hash);
  });
  test('se puede verificar por lotes', () => {
    const f = cadena(4);
    const a = verificarLote(inicio, f.slice(0, 2));
    const b = verificarLote(a.estado, f.slice(2));
    expect(b.rotaEnSecuencia).toBeUndefined();
    expect(b.estado.siguiente).toBe(5n);
  });
  test('contenido alterado → rota en esa secuencia', () => {
    const f = cadena(3);
    f[1] = { ...f[1]!, detalle: {} };
    expect(verificarLote(inicio, f).rotaEnSecuencia).toBe(2);
  });
  test('hash almacenado alterado → rota en esa secuencia', () => {
    const f = cadena(3);
    f[2] = { ...f[2]!, hash: 'f'.repeat(64) };
    expect(verificarLote(inicio, f).rotaEnSecuencia).toBe(3);
  });
  test('registro eliminado en medio (hueco) → rota en la secuencia faltante', () => {
    const f = cadena(4);
    f.splice(1, 1);
    expect(verificarLote(inicio, f).rotaEnSecuencia).toBe(2);
  });
  test('hash_anterior que no enlaza con el previo → rota ahí', () => {
    const f = cadena(3);
    f[1] = { ...f[1]!, hash_anterior: 'a'.repeat(64) };
    expect(verificarLote(inicio, f).rotaEnSecuencia).toBe(2);
  });
  test('lote vacío no cambia el estado', () => {
    expect(verificarLote(inicio, [])).toEqual({ estado: inicio });
  });
});
