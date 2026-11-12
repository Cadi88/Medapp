import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import { ipDelCliente, llamarGateway } from '@/lib/api/gateway';
import {
  cabeceraCookieAuthDe,
  COOKIE_CONSULTORIO,
  COOKIE_TOKEN,
  esCookieDeSesion,
  opcionesCookie,
  opcionesToken,
} from '@/lib/sesion/cookies';
import { destinoPorError, type Desvio } from '@/lib/sesion/desvios';
import { necesitaRenovar } from '@/lib/sesion/token';

/** Sin sesión. */
const RUTAS_PUBLICAS = new Set(['/login', '/login/mfa', '/registro']);
/** Flujo de entrada (y la página de acceso denegado): basta la sesión de Better Auth, sin consultorio ni token. */
const RUTAS_SOLO_SESION = new Set(['/cambiar-password', '/configurar-mfa', '/elegir-consultorio', '/sin-acceso']);

const respuestaTokenSchema = z.object({ token: z.string().min(1) });

/** 307 conserva el método: solo para GET/HEAD. Otro método (un POST de server action) va con 303 → GET. */
function redirigir(req: NextRequest, ruta: string): NextResponse {
  const status = req.method === 'GET' || req.method === 'HEAD' ? 307 : 303;
  return NextResponse.redirect(new URL(ruta, req.url), status);
}

function borrar(res: NextResponse, nombres: readonly string[]): NextResponse {
  for (const n of nombres) res.cookies.set(n, '', opcionesCookie(n, 0));
  return res;
}

const esDelConsultorio = (n: string) => n === COOKIE_TOKEN || n === COOKIE_CONSULTORIO;

/**
 * Desvío tras un error al renovar. 401: la sesión ya no sirve. PROHIBIDO: ya no es miembro de ese consultorio.
 * `/elegir-consultorio` (400/404): el `consultorio_id` guardado es inválido o ya no existe.
 */
function desviar(req: NextRequest, destino: Desvio | '/elegir-consultorio'): NextResponse {
  const res = redirigir(req, destino);
  const presentes = req.cookies.getAll().map((c) => c.name);
  if (destino === '/login') return borrar(res, presentes.filter(esCookieDeSesion));
  if (destino === '/sin-acceso' || destino === '/elegir-consultorio') return borrar(res, presentes.filter(esDelConsultorio));
  return res;
}

/**
 * Corre antes de cada petición (Next ≥ 16: `proxy`, antes `middleware`). Exige sesión, elige consultorio
 * y renueva el JWT del tenant cuando le quedan < 60 s: los Server Components no pueden escribir cookies.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (RUTAS_PUBLICAS.has(pathname)) return NextResponse.next();

  const cabeceraSesion = cabeceraCookieAuthDe(req.cookies.getAll());
  if (!cabeceraSesion) return redirigir(req, '/login');
  if (RUTAS_SOLO_SESION.has(pathname)) return NextResponse.next();

  const consultorio = req.cookies.get(COOKIE_CONSULTORIO)?.value;
  if (!consultorio) return redirigir(req, '/elegir-consultorio');
  if (!necesitaRenovar(req.cookies.get(COOKIE_TOKEN)?.value, new Date())) return NextResponse.next();

  const r = await llamarGateway('/api/identidad/sesion/tenant', {
    metodo: 'POST',
    cuerpo: { tenantId: consultorio },
    esquema: respuestaTokenSchema,
    auth: 'sesion',
    cabeceraCookie: cabeceraSesion,
    ip: ipDelCliente(req.headers),
  });

  if (r.ok) {
    // La petición en curso ve el token nuevo (cabecera reescrita) y el navegador lo guarda (Set-Cookie).
    req.cookies.set(COOKIE_TOKEN, r.datos.token);
    const res = NextResponse.next({ request: { headers: req.headers } });
    res.cookies.set(COOKIE_TOKEN, r.datos.token, opcionesToken());
    return res;
  }
  const destino = destinoPorError(r.error, r.status) ?? (r.status === 400 || r.status === 404 ? '/elegir-consultorio' : null);
  // Sin desvío (p. ej. gateway caído): la pantalla recibe el error y muestra el aviso genérico (frontera de error).
  return destino ? desviar(req, destino) : NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
