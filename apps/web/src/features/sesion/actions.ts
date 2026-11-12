'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import type { z } from 'zod';
import { ipDelCliente } from '@/lib/api/gateway';
import type { Resultado } from '@/lib/api/resultado';
import { cerrarSesion as borrarCookiesDeSesion, guardarConsultorio, guardarCookiesAuth, guardarToken, olvidarConsultorio } from '@/lib/sesion/cookies';
import { destinoPorError } from '@/lib/sesion/desvios';
import {
  cambiarPasswordEnApi,
  cerrarSesionEnApi,
  consultoriosDelUsuario,
  habilitarMfa,
  iniciarSesionConCorreo,
  registrar,
  tokenDelConsultorio,
  verificarCodigoTotp,
} from './api';
import {
  cambioPasswordSchema,
  elegirConsultorioSchema,
  erroresDeZod,
  loginSchema,
  passwordMfaSchema,
  registroSchema,
  textosDe,
  totpSchema,
} from './logica/validaciones';
import type { EstadoConfiguracionMfa, EstadoFormulario } from './tipos';

const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos';
const MENSAJE_LIMITE = 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';

/** Solo los campos indicados (nunca contraseñas ni códigos) y solo los que llegaron. */
function valoresVisibles(texto: Record<string, string | undefined>, campos: string[]): Record<string, string> {
  return Object.fromEntries(campos.flatMap((c) => (texto[c] === undefined ? [] : [[c, texto[c]]])));
}

async function ipActual(): Promise<string | undefined> {
  return ipDelCliente(await headers());
}

/** Valida el formulario; si falla, devuelve los errores por campo para `useActionState`. */
function leer<S extends z.ZodType>(esquema: S, valores: unknown, conservar: Record<string, string> = {}): { datos: z.output<S> } | { estado: EstadoFormulario } {
  const r = esquema.safeParse(valores);
  return r.success ? { datos: r.data } : { estado: { errores: erroresDeZod(r.error), valores: conservar } };
}

/** Error de la API: si corresponde a otra pantalla (sesión vencida, contraseña temporal, MFA…) redirige; si no, muestra el mensaje. */
function mostrarError(r: Extract<Resultado<unknown>, { ok: false }>): EstadoFormulario {
  const destino = destinoPorError(r.error, r.status);
  if (destino) redirect(destino);
  return { mensaje: r.status === 429 ? MENSAJE_LIMITE : r.error.message };
}

/** Pide el JWT del tenant y entra a la agenda; los errores de entrada (contraseña temporal, MFA) desvían a su pantalla. */
async function entrarAlConsultorio(tenantId: string, ip: string | undefined): Promise<EstadoFormulario> {
  const t = await tokenDelConsultorio(tenantId, ip);
  if (!t.ok) return mostrarError(t);
  await guardarConsultorio(tenantId);
  await guardarToken(t.datos.token);
  return redirect('/agenda');
}

export async function continuarAConsultorio(): Promise<EstadoFormulario> {
  const ip = await ipActual();
  const lista = await consultoriosDelUsuario(ip);
  if (!lista.ok) return mostrarError(lista);
  const [unico, ...otros] = lista.datos;
  if (!unico) return redirect('/sin-acceso');
  if (otros.length > 0) return redirect('/elegir-consultorio');
  return entrarAlConsultorio(unico.tenantId, ip);
}

export async function registrarConsultorio(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const texto = textosDe(fd);
  const valores = valoresVisibles(texto, ['nombreConsultorio', 'slug', 'zonaHoraria', 'esMedico', 'nombre', 'email']);
  const v = leer(registroSchema, { ...texto, esMedico: texto.esMedico === 'on' }, valores);
  if ('estado' in v) return v.estado;
  const d = v.datos;
  const ip = await ipActual();

  const r = await registrar(
    {
      nombreConsultorio: d.nombreConsultorio,
      slug: d.slug,
      zonaHoraria: d.zonaHoraria,
      esMedico: d.esMedico,
      admin: { nombre: d.nombre, email: d.email, password: d.password },
    },
    ip,
  );
  if (!r.ok) {
    const campo = (r.error.details as { campo?: string } | undefined)?.campo;
    if (r.status === 409 && campo === 'slug') return { errores: { slug: 'Ese identificador ya está en uso' }, valores };
    if (r.status === 409 && campo === 'email') return { errores: { email: 'Ese correo ya está registrado' }, valores };
    return { ...mostrarError(r), valores };
  }

  await olvidarConsultorio();
  const s = await iniciarSesionConCorreo(d.email, d.password, ip);
  // La cuenta ya existe: si el inicio de sesión automático falla, que entre manualmente.
  if (!s.ok || !s.setCookies) return redirect('/login');
  await guardarCookiesAuth(s.setCookies);
  return redirect('/configurar-mfa');
}

export async function iniciarSesion(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const texto = textosDe(fd);
  const valores = valoresVisibles(texto, ['email']);
  const v = leer(loginSchema, texto, valores);
  if ('estado' in v) return v.estado;

  // PC compartida: el consultorio y el token de la persona anterior no pasan a esta sesión.
  await olvidarConsultorio();
  const r = await iniciarSesionConCorreo(v.datos.email, v.datos.password, await ipActual());
  // Mismo mensaje para correo inexistente y contraseña errónea: no se revela cuál falló.
  if (!r.ok) return { ...(r.status === 401 ? { mensaje: MENSAJE_CREDENCIALES } : mostrarError(r)), valores };
  if (r.setCookies) await guardarCookiesAuth(r.setCookies);
  if (r.datos.twoFactorRedirect) return redirect('/login/mfa');
  return continuarAConsultorio();
}

/** `verify-totp` con la cookie de dos factores (login) o la sesión (alta del MFA); guarda las cookies y continúa. */
async function verificarYContinuar(fd: FormData): Promise<EstadoFormulario> {
  const v = leer(totpSchema, textosDe(fd));
  if ('estado' in v) return v.estado;
  const r = await verificarCodigoTotp(v.datos.codigo, await ipActual());
  if (!r.ok) return r.status === 401 || r.status === 400 ? { errores: { codigo: 'Código incorrecto o vencido' } } : mostrarError(r);
  if (r.setCookies) await guardarCookiesAuth(r.setCookies);
  return continuarAConsultorio();
}

export async function verificarTotp(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  return verificarYContinuar(fd);
}

export async function elegirConsultorio(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const v = leer(elegirConsultorioSchema, textosDe(fd));
  if ('estado' in v) return v.estado;
  return entrarAlConsultorio(v.datos.tenantId, await ipActual());
}

export async function cambiarPassword(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  const v = leer(cambioPasswordSchema, textosDe(fd));
  if ('estado' in v) return v.estado;
  const r = await cambiarPasswordEnApi(v.datos.actual, v.datos.nueva, await ipActual());
  if (!r.ok) return r.status === 400 ? { errores: { actual: 'La contraseña actual es incorrecta' } } : mostrarError(r);
  // Con `revokeOtherSessions` Better Auth emite una sesión nueva: se guarda antes de continuar.
  if (r.setCookies) await guardarCookiesAuth(r.setCookies);
  return continuarAConsultorio();
}

export async function iniciarConfiguracionMfa(_prev: EstadoConfiguracionMfa, fd: FormData): Promise<EstadoConfiguracionMfa> {
  const v = leer(passwordMfaSchema, textosDe(fd));
  if ('estado' in v) return v.estado;
  const r = await habilitarMfa(v.datos.password, await ipActual());
  if (!r.ok) return r.status === 400 ? { errores: { password: 'Contraseña incorrecta' } } : mostrarError(r);
  if (r.setCookies) await guardarCookiesAuth(r.setCookies);
  // El QR se dibuja en el servidor: el secreto TOTP no pasa por librerías del navegador.
  const qrSvg = await QRCode.toString(r.datos.totpURI, { type: 'svg', margin: 1 });
  const claveManual = new URL(r.datos.totpURI).searchParams.get('secret') ?? undefined;
  return { qrSvg, codigosRespaldo: r.datos.backupCodes, ...(claveManual ? { claveManual } : {}) };
}

export async function confirmarMfa(_prev: EstadoFormulario, fd: FormData): Promise<EstadoFormulario> {
  return verificarYContinuar(fd);
}

export async function cerrarSesion(): Promise<void> {
  // Si el gateway falla igual se borran las cookies: el usuario sale del sitio.
  await cerrarSesionEnApi(await ipActual());
  await borrarCookiesDeSesion();
  redirect('/login');
}
