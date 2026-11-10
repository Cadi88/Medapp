import { createHash } from 'node:crypto';

function canon(v: unknown): string {
  if (v === null) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined || typeof x === 'function' ? 'null' : canon(x))).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const parts = Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`);
    return `{${parts.join(',')}}`;
  }
  const s = JSON.stringify(v);
  if (s === undefined) throw new Error('valor no serializable a JSON canónico');
  return s;
}

/** JSON determinista: claves ordenadas recursivamente, sin espacios, `undefined` omitido en objetos. */
export function canonicalJson(v: unknown): string {
  return canon(v);
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
