import { createHash } from 'node:crypto';

const noJson = (detalle: string): Error => new Error(`canonicalJson: valor no es JSON plano (${detalle})`);

function canon(v: unknown, ancestros: Set<object>): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return JSON.stringify(v);
    case 'number':
      if (!Number.isFinite(v)) throw noJson(`número no finito: ${String(v)}`);
      return JSON.stringify(v);
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw noJson(typeof v);
  }
  const obj = v as object;
  if (ancestros.has(obj)) throw noJson('referencia circular');
  ancestros.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items: string[] = [];
      // Índice a índice: los huecos se leen como undefined y se rechazan.
      for (let i = 0; i < obj.length; i++) items.push(canon(obj[i], ancestros));
      return `[${items.join(',')}]`;
    }
    const proto: unknown = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw noJson(`objeto con prototipo no plano: ${(obj as { constructor?: { name?: string } }).constructor?.name ?? 'desconocido'}`);
    }
    const o = obj as Record<string, unknown>;
    const parts = Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canon(o[k], ancestros)}`);
    return `{${parts.join(',')}}`;
  } finally {
    ancestros.delete(obj);
  }
}

/**
 * JSON determinista: claves ordenadas recursivamente, sin espacios, `undefined` omitido en propiedades de objetos.
 * Solo acepta JSON plano (objetos planos, arreglos, strings, números finitos, booleanos, null); cualquier otra
 * cosa (Date, Buffer, Map, Set, bigint, NaN, funciones, `undefined` en arreglos o en la raíz...) lanza un Error.
 */
export function canonicalJson(v: unknown): string {
  return canon(v, new Set());
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
