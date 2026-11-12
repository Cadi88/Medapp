import 'server-only';
import type { z } from 'zod';
import { gatewayUrl } from '@/lib/config';
import { cabeceraCookieAuth, leerToken } from '@/lib/sesion/cookies';
import { errorDeRespuesta, exito, fallo, type Resultado } from './resultado';

export interface OpcionesGateway<T> {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
  /** Esquema de `packages/contracts` con el que se valida la respuesta exitosa. */
  esquema?: z.ZodType<T>;
  /** `token`: Bearer con el JWT del tenant. `sesion`: cookie de Better Auth (solo rutas de identidad). */
  auth: 'token' | 'sesion' | 'ninguna';
  /** Valor de `X-Forwarded-For` del cliente (ver `ipDelCliente`). */
  ip?: string;
  /**
   * Cabecera `Cookie` ya armada, para el proxy (allí se leen las cookies de la petición, no con `cookies()`).
   * Si se omite, con `auth: 'sesion'` se arma con las cookies de la petición en curso.
   */
  cabeceraCookie?: string;
}

/** La cookie de sesión de Better Auth solo la necesita identidad; nunca sale hacia otros servicios. */
const PREFIJO_IDENTIDAD = '/api/identidad/';

const ERROR_RED = { code: 'INTERNO', message: 'No se pudo contactar al servidor' } as const;
const ERROR_RESPUESTA = { code: 'INTERNO', message: 'Respuesta inesperada del servidor' } as const;

/**
 * URL absoluta y normalizada (`..` y `%2e%2e` resueltos) dentro del gateway. Rechaza una ruta que no empiece
 * con `/` o que cambie de origen (`//otro-host/...`): es un error de programación, no una respuesta de la API.
 */
function urlDelGateway(ruta: string): URL {
  const base = new URL(gatewayUrl());
  const url = ruta.startsWith('/') ? new URL(ruta, base) : undefined;
  if (!url || url.origin !== base.origin) throw new Error(`Ruta del gateway inválida: ${ruta}`);
  return url;
}

/** `url` ya normalizada: la decisión de enviar la cookie se toma sobre el `pathname` final, no sobre el texto recibido. */
async function cabeceras<T>(url: URL, o: OpcionesGateway<T>): Promise<Headers> {
  const h = new Headers({ accept: 'application/json' });
  if (o.cuerpo !== undefined) h.set('content-type', 'application/json');
  if (o.ip) h.set('x-forwarded-for', o.ip);
  if (o.auth === 'token') {
    const token = await leerToken();
    if (token) h.set('authorization', `Bearer ${token}`);
  }
  if (o.auth === 'sesion' && url.pathname.startsWith(PREFIJO_IDENTIDAD)) {
    const cookie = o.cabeceraCookie ?? (await cabeceraCookieAuth());
    if (cookie) h.set('cookie', cookie);
  }
  return h;
}

async function leerCuerpo(res: Response): Promise<unknown> {
  const texto = await res.text();
  if (!texto) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

/**
 * Llama al gateway desde el servidor de Next. Nunca lanza por errores de la API ni de red:
 * devuelve un `Resultado` (red caída → 503; respuesta fuera de contrato → 502 INTERNO).
 */
export async function llamarGateway<T = unknown>(ruta: string, o: OpcionesGateway<T>): Promise<Resultado<T>> {
  const url = urlDelGateway(ruta);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: o.metodo ?? 'GET',
      headers: await cabeceras(url, o),
      ...(o.cuerpo === undefined ? {} : { body: JSON.stringify(o.cuerpo) }),
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return fallo(503, ERROR_RED);
  }

  const setCookies = o.auth === 'token' ? undefined : res.headers.getSetCookie();
  const conCookies = setCookies?.length ? setCookies : undefined;
  const cuerpo = await leerCuerpo(res);
  if (!res.ok) return fallo(res.status, errorDeRespuesta(res.status, cuerpo), conCookies);
  if (!o.esquema) return exito(cuerpo as T, conCookies);
  const v = o.esquema.safeParse(cuerpo);
  return v.success ? exito(v.data, conCookies) : fallo(502, ERROR_RESPUESTA);
}

/**
 * IP del cliente para el gateway: SOLO el último salto de `X-Forwarded-For`, el que agrega el proxy inverso que
 * está delante de `web`. Las entradas anteriores las puede escribir el cliente y se descartan.
 *
 * Dependencia de despliegue: delante de `web` debe ir un proxy inverso que AGREGUE `X-Forwarded-For` (el ALB en
 * producción). Next solo lo fija si falta (`??=`), así que un cliente que llega directo a Next elige su IP; en
 * desarrollo local se acepta. El gateway confía únicamente en la IP de `web` (`CONFIAR_EN_PROXY`).
 */
export function ipDelCliente(cabeceras: Pick<Headers, 'get'>): string | undefined {
  const ultimo = cabeceras.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return ultimo || undefined;
}
