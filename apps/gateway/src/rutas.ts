import { isPublicPath } from '@consultorio/platform';

export type Servicio = 'identidad' | 'auditoria' | 'agenda' | 'notificaciones';
export type Acceso = 'publica' | 'sesion' | 'protegida' | 'bloqueada';

export interface RutaReenviable {
  servicio: Servicio;
  /** Ruta + query tal cual llegó, sin el prefijo `/api/<servicio>`. */
  rutaDestino: string;
  acceso: Exclude<Acceso, 'bloqueada'>;
}
/** Ruta interna entre servicios: el gateway nunca la reenvía (404). */
export interface RutaBloqueada {
  acceso: 'bloqueada';
}
export type Clasificacion = RutaReenviable | RutaBloqueada;

interface ReglaAbierta {
  metodos: readonly string[];
  /** Exacta, o por prefijo si termina en `/*` (misma semántica que `isPublicPath`). */
  patron: string;
  acceso: Exclude<Acceso, 'protegida' | 'bloqueada'>;
}

const P = '/api/identidad';

/** Únicas rutas que no exigen JWT de tenant en el gateway (con su método). El resto es protegida. */
export const REGLAS_ABIERTAS: readonly ReglaAbierta[] = [
  { metodos: ['POST'], patron: `${P}/registro`, acceso: 'publica' },
  { metodos: ['GET', 'POST'], patron: `${P}/auth/*`, acceso: 'publica' },
  { metodos: ['GET'], patron: `${P}/.well-known/jwks.json`, acceso: 'publica' },
  { metodos: ['GET'], patron: `${P}/tenants/mios`, acceso: 'sesion' },
  { metodos: ['POST'], patron: `${P}/sesion/tenant`, acceso: 'sesion' },
  // Página pública de respuesta del paciente: el token del enlace es la credencial.
  { metodos: ['GET', 'POST'], patron: '/api/notificaciones/respuestas/*', acceso: 'publica' },
];

/** Lista para `platformPlugin` (solo ruta, sin método: el método se vuelve a comprobar en el handler). */
export const RUTAS_PUBLICAS: readonly string[] = REGLAS_ABIERTAS.map((r) => r.patron);

const SERVICIOS: readonly Servicio[] = ['identidad', 'auditoria', 'agenda', 'notificaciones'];

const rutaSinQuery = (url: string): string => {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
};

/**
 * `/api/<servicio>/interno` y `/api/<servicio>/interno/*` son rutas entre servicios (token interno): nunca se
 * exponen. Vale para cualquier nombre de servicio, también los que aún no existen en el gateway.
 */
export function esRutaInterna(url: string): boolean {
  // Se compara el segmento decodificado: el destino decodifica `%69nterno` y enruta a `/interno`.
  const segmentos = rutaSinQuery(url).split('/');
  if (segmentos[1]?.toLowerCase() !== 'api' || segmentos.length < 4) return false;
  try {
    return decodeURIComponent(segmentos[3] ?? '').toLowerCase() === 'interno';
  } catch {
    return false; // secuencia inválida: `rutaPermitida` la rechaza
  }
}

/**
 * Clasifica una petición entrante. `null` = ruta fuera de `/api/<servicio>/` (desconocida).
 * Una ruta abierta solo lo es si coincide método y ruta cruda (sin normalizar; `..`, `//` o `%2e/%2f/%5c`
 * nunca son abiertas). Todo lo demás bajo un servicio es protegida.
 */
export function clasificarRuta(metodo: string, url: string): Clasificacion | null {
  if (esRutaInterna(url)) return { acceso: 'bloqueada' };
  const path = rutaSinQuery(url);
  for (const servicio of SERVICIOS) {
    const prefijo = `/api/${servicio}`;
    if (!path.startsWith(`${prefijo}/`)) continue;
    const m = metodo.toUpperCase();
    const regla = REGLAS_ABIERTAS.find((r) => r.metodos.includes(m) && isPublicPath(url, [r.patron]));
    return { servicio, rutaDestino: url.slice(prefijo.length), acceso: regla?.acceso ?? 'protegida' };
  }
  return null;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Cabeceras del cliente que se reenvían (lista cerrada: nada más cruza el gateway). */
const REENVIADAS = ['authorization', 'cookie', 'content-type', 'origin', 'user-agent', 'accept', 'accept-language'] as const;
/** La cookie es la sesión de Better Auth: solo la necesita identidad; ningún otro servicio la recibe. */
const SOLO_IDENTIDAD = new Set<string>(['cookie']);

export interface ContextoReenvio {
  /** Trace id ya sanitizado/generado por el plugin (nunca el valor crudo del cliente). */
  traceId: string;
  /** IP del cliente según el gateway (`request.ip`, respeta `trustProxy`). */
  ip: string;
  protocolo: string;
  /** Servicio destino: la cookie solo se reenvía a identidad. */
  servicio: Servicio;
}

type Cabeceras = Record<string, string | string[] | undefined>;

export function filtrarCabecerasPeticion(entrantes: Cabeceras, ctx: ContextoReenvio): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const nombre of REENVIADAS) {
    if (SOLO_IDENTIDAD.has(nombre) && ctx.servicio !== 'identidad') continue;
    const v = entrantes[nombre];
    if (typeof v === 'string') salida[nombre] = v;
  }
  salida['x-trace-id'] = ctx.traceId;
  salida['x-forwarded-for'] = ctx.ip;
  salida['x-forwarded-proto'] = ctx.protocolo;
  return salida;
}

/** Quita hop-by-hop (y las listadas en `Connection`) y `x-trace-id` (el gateway pone el suyo). `Set-Cookie` queda como arreglo. */
export function filtrarCabecerasRespuesta(destino: Cabeceras): Record<string, string | string[]> {
  const conexion = destino.connection;
  const extra = new Set(
    (typeof conexion === 'string' ? conexion : '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const salida: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(destino)) {
    const nombre = k.toLowerCase();
    if (v === undefined || HOP_BY_HOP.has(nombre) || extra.has(nombre) || nombre === 'x-trace-id') continue;
    salida[nombre] = v;
  }
  return salida;
}

/**
 * Una ruta bajo `/api/` es válida solo si su ruta CRUDA (sin query) no tiene segmentos `.`/`..`, ni `%2e`,
 * `%2f`, `%5c` (en cualquier combinación de mayúsculas), ni backslash, ni `//`. Así el destino jamás recibe
 * una ruta que un normalizador (WHATWG URL, proxy) pueda resolver a otra distinta de la clasificada.
 */
export function rutaPermitida(url: string): boolean {
  const path = rutaSinQuery(url);
  // Ningún carácter no reservado puede ir codificado (%69 = i): el destino lo decodificaría a otra ruta que la clasificada.
  if (/%(?:[46][1-9a-f]|[57][0-9a]|3[0-9]|2d|2e|2f|5c|5f|7e)/i.test(path) || path.includes('\\') || path.includes('//')) return false;
  try {
    decodeURIComponent(path);
  } catch {
    return false;
  }
  return !path.split('/').some((s) => s === '.' || s === '..');
}

/**
 * URL final hacia el destino, o `null` si construirla cambiaría la ruta o el query (normalización de la URL):
 * el destino debe recibir exactamente lo clasificado. Falla cerrado.
 */
export function urlDestino(base: string, rutaDestino: string): string | null {
  try {
    const b = new URL(base);
    const u = new URL(base.replace(/\/+$/, '') + rutaDestino);
    const esperado = b.pathname.replace(/\/+$/, '') + rutaDestino;
    return u.pathname + u.search === esperado ? u.href : null;
  } catch {
    return null;
  }
}
