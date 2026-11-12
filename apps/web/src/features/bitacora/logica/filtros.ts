import { DateTime } from 'luxon';
import { z } from 'zod';
import type { ConsultaBitacora } from '../tipos';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Misma forma que valida el servicio de auditoría. */
export const accionSchema = z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/);

type Parametro = string | string[] | undefined;

const primero = (p: Parametro): string | undefined => (Array.isArray(p) ? p[0] : p);

function dia(p: Parametro, zona: string): DateTime | undefined {
  const t = primero(p);
  if (!t || !FECHA.test(t)) return undefined;
  const d = DateTime.fromISO(t, { zone: zona });
  return d.isValid ? d : undefined;
}

/**
 * Filtros de la URL (`desde` y `hasta` son días `YYYY-MM-DD` del consultorio, ambos inclusivos) como instantes UTC
 * para la API. Lo inválido se ignora: los filtros vienen de la barra de direcciones y no son de confianza.
 */
export function consultaDesdeParametros(p: Record<string, Parametro>, zona: string): ConsultaBitacora {
  const desde = dia(p.desde, zona)?.startOf('day');
  let hasta = dia(p.hasta, zona)?.endOf('day');
  if (desde && hasta && desde > hasta) hasta = undefined;
  const accion = accionSchema.safeParse(primero(p.accion));
  return {
    ...(desde ? { desde: desde.toUTC().toISO() as string } : {}),
    ...(hasta ? { hasta: hasta.toUTC().toISO() as string } : {}),
    ...(accion.success ? { accion: accion.data } : {}),
  };
}

export function nombreDelActor(actorId: string | null | undefined, nombres: Record<string, string>): string {
  if (!actorId) return 'Sistema';
  return nombres[actorId] ?? `Exmiembro (${actorId.slice(0, 8)})`;
}

/** "12 nov 2026, 10:00" en la zona del consultorio. */
export function formatearFechaEvento(instante: string, zona: string): string {
  return DateTime.fromISO(instante, { zone: zona }).setLocale('es-MX').toFormat('d LLL yyyy, HH:mm');
}
