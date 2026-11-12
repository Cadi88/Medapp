/**
 * Configuración del sitio (solo servidor). Se lee en cada llamada, no al importar:
 * `next build` evalúa los módulos sin las variables del runtime.
 */
type Env = Record<string, string | undefined>;

/** `GATEWAY_URL` (obligatoria): URL interna del gateway; el navegador nunca habla con él. */
export function gatewayUrl(env: Env = process.env): string {
  const v = env.GATEWAY_URL;
  if (!v) throw new Error('Falta la variable de entorno GATEWAY_URL');
  return v.replace(/\/+$/, '');
}

/** `COOKIE_SEGURA`: `'true'` en producción (HTTPS) para que las cookies lleven `Secure`. */
export function cookieSegura(env: Env = process.env): boolean {
  return env.COOKIE_SEGURA === 'true';
}

/** `WEB_ORIGEN`: origen público del sitio (p. ej. `http://localhost:3000`); se envía como `Origin` a Better Auth. */
export function webOrigen(env: Env = process.env): string | undefined {
  return env.WEB_ORIGEN?.replace(/\/+$/, '') || undefined;
}
