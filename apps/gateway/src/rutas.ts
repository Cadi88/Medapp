import { isPublicPath } from '@consultorio/platform';

export type Servicio = 'identidad' | 'auditoria';
export type Acceso = 'publica' | 'sesion' | 'protegida';

export interface Clasificacion {
  servicio: Servicio;
  /** Ruta + query tal cual llegó, sin el prefijo `/api/<servicio>`. */
  rutaDestino: string;
  acceso: Acceso;
}

interface ReglaAbierta {
  metodos: readonly string[];
  /** Exacta, o por prefijo si termina en `/*` (misma semántica que `isPublicPath`). */
  patron: string;
  acceso: Exclude<Acceso, 'protegida'>;
}

const P = '/api/identidad';

/** Únicas rutas que no exigen JWT de tenant en el gateway (con su método). El resto es protegida. */
export const REGLAS_ABIERTAS: readonly ReglaAbierta[] = [
  { metodos: ['POST'], patron: `${P}/registro`, acceso: 'publica' },
  { metodos: ['GET', 'POST'], patron: `${P}/auth/*`, acceso: 'publica' },
  { metodos: ['GET'], patron: `${P}/.well-known/jwks.json`, acceso: 'publica' },
  { metodos: ['GET'], patron: `${P}/tenants/mios`, acceso: 'sesion' },
  { metodos: ['POST'], patron: `${P}/sesion/tenant`, acceso: 'sesion' },
];

/** Lista para `platformPlugin` (solo ruta, sin método: el método se vuelve a comprobar en el handler). */
export const RUTAS_PUBLICAS: readonly string[] = REGLAS_ABIERTAS.map((r) => r.patron);

const SERVICIOS: readonly Servicio[] = ['identidad', 'auditoria'];

const rutaSinQuery = (url: string): string => {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
};

/**
 * Clasifica una petición entrante. `null` = ruta fuera de `/api/<servicio>/` (desconocida).
 * Una ruta abierta solo lo es si coincide método y ruta cruda (sin normalizar; `..`, `//` o `%2e/%2f/%5c`
 * nunca son abiertas). Todo lo demás bajo un servicio es protegida.
 */
export function clasificarRuta(metodo: string, url: string): Clasificacion | null {
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

export interface ContextoReenvio {
  /** Trace id ya sanitizado/generado por el plugin (nunca el valor crudo del cliente). */
  traceId: string;
  /** IP del cliente según el gateway (`request.ip`, respeta `trustProxy`). */
  ip: string;
  protocolo: string;
}

type Cabeceras = Record<string, string | string[] | undefined>;

export function filtrarCabecerasPeticion(entrantes: Cabeceras, ctx: ContextoReenvio): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const nombre of REENVIADAS) {
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
