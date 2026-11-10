import { randomUUID } from 'node:crypto';

const TRACE_ID_RE = /^[a-zA-Z0-9-]{1,64}$/;

/** Devuelve el trace id entrante si es seguro; si no, uno nuevo (UUID sin guiones). */
export function sanitizeTraceId(incoming: unknown): string {
  if (typeof incoming === 'string' && TRACE_ID_RE.test(incoming)) return incoming;
  return randomUUID().replaceAll('-', '');
}

/** Ruta de la petición sin query string ni fragmento. */
export function pathOf(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

/**
 * Decide si una petición es pública. Se compara contra la ruta CRUDA (sin query), no normalizada:
 * una ruta con segmentos `.`/`..`, backslash, `//` o secuencias %-codificadas de `.`, `/`, `\`
 * NUNCA es pública (falla cerrado: exige token), así ningún proxy/normalizador intermedio puede
 * convertir `/registro/../privada` en un acceso sin autenticar.
 * Una entrada coincide exacta, o por prefijo si termina en `/*` (`/auth/*` cubre `/auth/x`, no `/authx` ni `/auth`).
 */
export function isPublicPath(url: string, rutasPublicas: readonly string[]): boolean {
  const path = pathOf(url);
  if (!path.startsWith('/')) return false;
  if (/%(2e|2f|5c)/i.test(path) || path.includes('\\') || path.includes('//')) return false;
  if (path.split('/').some((s) => s === '.' || s === '..')) return false;
  return rutasPublicas.some((r) =>
    r.endsWith('/*') ? path.startsWith(r.slice(0, -1)) && path.length > r.length - 1 : path === r,
  );
}
