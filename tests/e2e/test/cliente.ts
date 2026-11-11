import { randomUUID } from 'node:crypto';
import { generate } from 'otplib';

export const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
/** Origin que Better Auth acepta: coincide con BETTER_AUTH_URL de svc-identidad (el gateway publicado). */
export const ORIGEN = process.env.E2E_ORIGIN ?? 'http://localhost:8080';
export const PASSWORD = 'clave-e2e-segura-123';

export interface Respuesta<T = unknown> {
  status: number;
  cuerpo: T;
  cookies: string[];
}

/**
 * Better Auth limita el sign-in (3 por 10 s por IP). Ante un 429 se espera lo que indica la propia
 * respuesta (`x-retry-after`) y se reintenta: es respetar el límite, no una espera para sincronizar.
 */
export async function peticion<T = unknown>(
  metodo: 'GET' | 'POST',
  ruta: string,
  o: { cuerpo?: object; token?: string; cookie?: string } = {},
): Promise<Respuesta<T>> {
  for (let intento = 0; ; intento++) {
    const r = await enviar<T>(metodo, ruta, o);
    if (r.status !== 429 || intento >= 4) return r;
    await new Promise((fin) => setTimeout(fin, (r.reintentarEnSeg ?? 10) * 1000));
  }
}

async function enviar<T>(
  metodo: 'GET' | 'POST',
  ruta: string,
  o: { cuerpo?: object; token?: string; cookie?: string },
): Promise<Respuesta<T> & { reintentarEnSeg?: number }> {
  const res = await fetch(`${BASE_URL}${ruta}`, {
    method: metodo,
    headers: {
      origin: ORIGEN,
      ...(o.cuerpo ? { 'content-type': 'application/json' } : {}),
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      ...(o.cookie ? { cookie: o.cookie } : {}),
    },
    ...(o.cuerpo ? { body: JSON.stringify(o.cuerpo) } : {}),
  });
  const texto = await res.text();
  const espera = Number(res.headers.get('x-retry-after') ?? res.headers.get('retry-after'));
  return {
    status: res.status,
    cuerpo: (texto ? JSON.parse(texto) : undefined) as T,
    cookies: res.headers.getSetCookie(),
    ...(Number.isFinite(espera) && espera > 0 ? { reintentarEnSeg: espera } : {}),
  };
}

/** Acumula cookies de `set-cookie` (descarta las expiradas/vacías). */
export function mezclarCookies(actual: string, nuevas: string[]): string {
  const jar = new Map<string, string>();
  for (const par of actual.split('; ').filter(Boolean)) {
    const i = par.indexOf('=');
    jar.set(par.slice(0, i), par.slice(i + 1));
  }
  for (const c of nuevas) {
    const [par = ''] = c.split(';');
    const i = par.indexOf('=');
    const valor = par.slice(i + 1);
    if (valor === '' || /max-age=0/i.test(c)) jar.delete(par.slice(0, i));
    else jar.set(par.slice(0, i), valor);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

export function registro(slug: string) {
  return {
    nombreConsultorio: `Consultorio ${slug}`,
    slug,
    zonaHoraria: 'America/Mexico_City',
    admin: { nombre: 'Admin E2E', email: `admin@${slug}.mx`, password: PASSWORD },
  };
}

/** Slug único por ejecución (las repeticiones no colisionan). */
export const slugUnico = (prefijo: string): string => `${prefijo}-${randomUUID().slice(0, 8)}`;

const post = <T>(ruta: string, cuerpo: object, cookie?: string) => peticion<T>('POST', ruta, { cuerpo, ...(cookie ? { cookie } : {}) });

const codigoTotp = (secret: string) => generate({ secret, strategy: 'totp' });

function secretoDeUri(totpURI: string): string {
  const s = new URL(totpURI).searchParams.get('secret');
  if (!s) throw new Error('totpURI sin secreto');
  return s;
}

function exigir(r: Respuesta, esperado: number, paso: string): void {
  if (r.status !== esperado) throw new Error(`${paso}: se esperaba ${esperado}, llegó ${r.status} ${JSON.stringify(r.cuerpo)}`);
}

/**
 * Flujo completo de un admin recién registrado: sign-in con contraseña, activar TOTP
 * (enable, verify-totp), nuevo sign-in con desafío 2FA y verify-totp. Devuelve la cookie de sesión.
 */
export async function iniciarSesionConTotp(email: string, password = PASSWORD): Promise<string> {
  const inicial = await post('/api/identidad/auth/sign-in/email', { email, password });
  exigir(inicial, 200, 'sign-in inicial');
  let cookie = mezclarCookies('', inicial.cookies);

  const enable = await post<{ totpURI: string }>('/api/identidad/auth/two-factor/enable', { password }, cookie);
  exigir(enable, 200, 'two-factor/enable');
  const secret = secretoDeUri(enable.cuerpo.totpURI);
  const activar = await post('/api/identidad/auth/two-factor/verify-totp', { code: await codigoTotp(secret) }, cookie);
  exigir(activar, 200, 'verify-totp (activación)');
  cookie = mezclarCookies(cookie, activar.cookies);

  const login = await post<{ twoFactorRedirect?: boolean }>('/api/identidad/auth/sign-in/email', { email, password });
  exigir(login, 200, 'sign-in con 2FA');
  if (!login.cuerpo.twoFactorRedirect) throw new Error('se esperaba twoFactorRedirect');
  cookie = mezclarCookies('', login.cookies);
  const v = await post('/api/identidad/auth/two-factor/verify-totp', { code: await codigoTotp(secret) }, cookie);
  exigir(v, 200, 'verify-totp (login)');
  cookie = mezclarCookies(cookie, v.cookies);
  if (!cookie.includes('session_token')) throw new Error('verify-totp no abrió sesión');
  return cookie;
}

/** Registra un consultorio y devuelve su token de tenant (admin con MFA). */
export async function crearConsultorio(slug: string): Promise<{ tenantId: string; token: string }> {
  const reg = await post<{ tenantId: string }>('/api/identidad/registro', registro(slug));
  exigir(reg, 201, 'registro');
  const cookie = await iniciarSesionConTotp(`admin@${slug}.mx`);
  const t = await post<{ token: string }>('/api/identidad/sesion/tenant', { tenantId: reg.cuerpo.tenantId }, cookie);
  exigir(t, 200, 'sesion/tenant');
  return { tenantId: reg.cuerpo.tenantId, token: t.cuerpo.token };
}
