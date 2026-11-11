import type pg from 'pg';
import type { Logger } from 'pino';
import { verificarCadena, type ResultadoVerificacion } from './verificacion.js';

export const ZONA_VERIFICACION = 'America/Mexico_City';
export const HORA_VERIFICACION = 3;
/** Advisory lock de sesión: una sola réplica ejecuta la verificación diaria. */
export const LOCK_VERIFICACION = 24_024_001;

interface Partes {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function partesEn(instante: number, zona: string): Partes {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(new Date(instante))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

/** Desfase (ms) de la zona respecto a UTC en `instante`. */
function desfase(instante: number, zona: string): number {
  const p = partesEn(instante, zona);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instante / 1000) * 1000;
}

/** Instante UTC en que el reloj de `zona` marca `hora`:00 del día local (y, m, d); `d` puede desbordar. */
function localAInstante(y: number, m: number, d: number, hora: number, zona: string): number {
  const ingenuo = Date.UTC(y, m - 1, d, hora);
  const d1 = desfase(ingenuo, zona);
  const t = ingenuo - d1;
  const d2 = desfase(t, zona);
  return d2 === d1 ? t : ingenuo - d2;
}

/** Próximo instante estrictamente posterior a `ahora` en que el reloj de `zona` marca `hora`:00 (por defecto 03:00 CDMX). */
export function proximaEjecucion(ahora: Date, zona = ZONA_VERIFICACION, hora = HORA_VERIFICACION): Date {
  const t = ahora.getTime();
  const p = partesEn(t, zona);
  const hoy = localAInstante(p.y, p.m, p.d, hora, zona);
  return new Date(hoy > t ? hoy : localAInstante(p.y, p.m, p.d + 1, hora, zona));
}

export interface ResultadoEjecucion {
  ejecutada: boolean;
  tenants: number;
  rotas: number;
}

export interface EjecucionOptions {
  pool: pg.Pool;
  logger: Logger;
  verificar?: (pool: pg.Pool, tenantId: string) => Promise<ResultadoVerificacion>;
}

/**
 * Verifica la cadena de todos los tenants si esta réplica obtiene el advisory lock; si no, no hace nada.
 * Una cadena rota se alerta con `logger.error({ alerta: 'cadena_auditoria_rota', tenant_id, secuencia })`.
 */
export async function ejecutarVerificacion(o: EjecucionOptions): Promise<ResultadoEjecucion> {
  const verificar = o.verificar ?? verificarCadena;
  const client = await o.pool.connect();
  let destruir: Error | undefined;
  try {
    const lock = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_VERIFICACION]);
    if (!lock.rows[0]?.ok) return { ejecutada: false, tenants: 0, rotas: 0 };
    try {
      const { rows } = await client.query<{ tenant_id: string }>('SELECT tenant_id FROM fn_tenants_auditados()');
      let rotas = 0;
      for (const { tenant_id } of rows) {
        try {
          const r = await verificar(o.pool, tenant_id);
          if (!r.valida) {
            rotas++;
            o.logger.error({ alerta: 'cadena_auditoria_rota', tenant_id, secuencia: r.rotaEnSecuencia }, 'cadena de auditoría rota');
          }
        } catch (err) {
          o.logger.error({ err, tenant_id }, 'no se pudo verificar la cadena de auditoría');
        }
      }
      o.logger.info({ tenants: rows.length, rotas }, 'verificación de cadenas de auditoría terminada');
      return { ejecutada: true, tenants: rows.length, rotas };
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_VERIFICACION]);
      } catch (err) {
        // Conexión en estado desconocido: se descarta (cerrarla también libera el lock de sesión).
        destruir = err instanceof Error ? err : new Error(String(err));
      }
    }
  } finally {
    if (destruir) client.release(destruir);
    else client.release();
  }
}

export interface ProgramadorOptions {
  pool: pg.Pool;
  logger: Logger;
  ejecutar?: () => Promise<ResultadoEjecucion>;
  ahora?: () => Date;
}

/** Programador en proceso (sin pg-boss): `setTimeout` hasta la próxima 03:00 de Ciudad de México, y reprograma. */
export function iniciarProgramador(o: ProgramadorOptions): { stop(): Promise<void> } {
  const ahora = o.ahora ?? ((): Date => new Date());
  const ejecutar = o.ejecutar ?? ((): Promise<ResultadoEjecucion> => ejecutarVerificacion({ pool: o.pool, logger: o.logger }));
  let timer: NodeJS.Timeout | undefined;
  let enCurso: Promise<void> | undefined;
  let parado = false;

  const programar = (desde: Date): void => {
    const objetivo = proximaEjecucion(desde);
    timer = setTimeout(() => {
      enCurso = (async () => {
        try {
          await ejecutar();
        } catch (err) {
          o.logger.error({ err }, 'falló la verificación diaria de cadenas de auditoría');
        }
      })().finally(() => {
        enCurso = undefined;
        // Se parte de max(ahora, objetivo) para no repetir si el temporizador disparó unos ms antes.
        if (!parado) programar(new Date(Math.max(ahora().getTime(), objetivo.getTime())));
      });
    }, Math.max(0, objetivo.getTime() - ahora().getTime()));
  };
  programar(ahora());

  return {
    async stop() {
      parado = true;
      if (timer) clearTimeout(timer);
      await enCurso;
    },
  };
}
