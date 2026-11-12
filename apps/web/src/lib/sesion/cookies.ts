import { cookies } from 'next/headers';
import { cookieSegura } from '@/lib/config';

/** JWT del tenant (15 min) y consultorio elegido: cookies propias del sitio. */
export const COOKIE_TOKEN = 'token_consultorio';
export const COOKIE_CONSULTORIO = 'consultorio_id';
const MAX_AGE_TOKEN_S = 15 * 60;
/** El consultorio elegido dura lo que la sesión de Better Auth (7 días por defecto). */
const MAX_AGE_CONSULTORIO_S = 7 * 24 * 60 * 60;

/** Cookies de Better Auth: `better-auth.*` (con prefijo `__Secure-` bajo HTTPS). */
export function esCookieAuth(nombre: string): boolean {
  return nombre.includes('better-auth.');
}

/** Toda cookie que forma parte de la sesión del sitio y se borra al cerrarla. */
export function esCookieDeSesion(nombre: string): boolean {
  return esCookieAuth(nombre) || nombre === COOKIE_TOKEN || nombre === COOKIE_CONSULTORIO;
}

/** Atributos comunes: httpOnly (el JS del navegador no las lee), SameSite=Lax y Secure en producción. */
export function opcionesCookie(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cookieSegura(),
    path: '/',
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

export const opcionesToken = () => opcionesCookie(MAX_AGE_TOKEN_S);

export interface CookieRecibida {
  name: string;
  /** Decodificado: Next lo vuelve a codificar al escribirlo, así el navegador recibe el valor original. */
  value: string;
  maxAge?: number;
  expires?: Date;
}

function decodificar(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Interpreta una cabecera `Set-Cookie`: nombre, valor y vigencia (los demás atributos los fija el sitio). */
export function interpretarSetCookie(setCookie: string): CookieRecibida | null {
  const [par = '', ...atributos] = setCookie.split(';');
  const i = par.indexOf('=');
  const name = par.slice(0, i).trim();
  if (i <= 0 || !name) return null;
  const cookie: CookieRecibida = { name, value: decodificar(par.slice(i + 1).trim()) };
  for (const a of atributos) {
    const [clave = '', ...resto] = a.split('=');
    const valor = resto.join('=').trim();
    const k = clave.trim().toLowerCase();
    if (k === 'max-age' && /^-?\d+$/.test(valor)) cookie.maxAge = Number(valor);
    if (k === 'expires' && !Number.isNaN(Date.parse(valor))) cookie.expires = new Date(valor);
  }
  return cookie;
}

/** Cabecera `Cookie` hacia identidad con solo las cookies de Better Auth (valores codificados como llegaron). */
export function cabeceraCookieAuthDe(lista: readonly { name: string; value: string }[]): string {
  return lista
    .filter((c) => esCookieAuth(c.name))
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
}

/** Replica en el dominio del sitio cada cookie de Better Auth que devolvió el gateway (las demás se ignoran). */
export async function guardarCookiesAuth(setCookies: readonly string[]): Promise<void> {
  const almacen = await cookies();
  for (const sc of setCookies) {
    const c = interpretarSetCookie(sc);
    if (!c || !esCookieAuth(c.name)) continue;
    almacen.set(c.name, c.value, { ...opcionesCookie(c.maxAge), ...(c.expires ? { expires: c.expires } : {}) });
  }
}

export async function cabeceraCookieAuth(): Promise<string> {
  return cabeceraCookieAuthDe((await cookies()).getAll());
}

export async function guardarToken(token: string): Promise<void> {
  (await cookies()).set(COOKIE_TOKEN, token, opcionesToken());
}

export async function leerToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_TOKEN)?.value;
}

export async function guardarConsultorio(id: string): Promise<void> {
  (await cookies()).set(COOKIE_CONSULTORIO, id, opcionesCookie(MAX_AGE_CONSULTORIO_S));
}

export async function leerConsultorio(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_CONSULTORIO)?.value;
}

/** Borra la sesión del sitio: cookies de Better Auth, token y consultorio. */
export async function cerrarSesion(): Promise<void> {
  const almacen = await cookies();
  for (const c of almacen.getAll()) {
    if (esCookieDeSesion(c.name)) almacen.set(c.name, '', opcionesCookie(0));
  }
}
