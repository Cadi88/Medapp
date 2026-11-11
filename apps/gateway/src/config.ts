export interface GatewayConfig {
  port: number;
  jwksUrl: string;
  destinos: { identidad: string; auditoria: string };
  confiarEnProxy: boolean | string;
  limitePublicoPorMin: number;
}

type Env = Record<string, string | undefined>;

/**
 * `CONFIAR_EN_PROXY`: vacío/`false` = no confiar (por defecto); `true` = confiar en todo salto;
 * otro texto = lista de IP/CIDR separadas por comas (la subred del ALB). Un entero se rechaza: Fastify 5
 * lo trata como "no confiar en nadie", lo que dejaría el rate limit global sin avisar.
 */
export function parseConfiarEnProxy(v: string | undefined): boolean | string {
  const t = (v ?? '').trim();
  if (t === '' || t === 'false') return false;
  if (t === 'true') return true;
  if (/^\d+$/.test(t)) throw new Error('CONFIAR_EN_PROXY no admite un número de saltos; usar true o una lista de CIDR');
  return t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
}

function requerida(env: Env, nombre: string): string {
  const v = env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

function entero(env: Env, nombre: string, defecto: number, minimo: number): number {
  const v = env[nombre];
  if (v === undefined || v === '') return defecto;
  const n = Number(v);
  if (!Number.isInteger(n) || n < minimo) throw new Error(`${nombre} inválida: se esperaba un entero >= ${minimo}`);
  return n;
}

/** Interpreta las variables de entorno del gateway (la telemetría OTEL la lee `initTelemetry`). */
export function leerConfig(env: Env): GatewayConfig {
  return {
    port: entero(env, 'PORT', 3000, 1),
    jwksUrl: requerida(env, 'JWKS_URL'),
    destinos: { identidad: requerida(env, 'IDENTIDAD_URL'), auditoria: requerida(env, 'AUDITORIA_URL') },
    confiarEnProxy: parseConfiarEnProxy(env.CONFIAR_EN_PROXY),
    limitePublicoPorMin: entero(env, 'LIMITE_PUBLICO_POR_MIN', 60, 1),
  };
}
