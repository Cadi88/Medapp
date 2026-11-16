import { DateTime } from 'luxon';

/** Días (inclusive) que puede abarcar una consulta de recordatorios. */
export const MAX_DIAS_VENTANA = 8;

export type VentanaLocal = { inicioUtc: Date; finUtc: Date } | { error: string };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Días locales [desde 00:00, hasta + 1 día 00:00) en `zona`, convertidos a UTC (correcto también en cambios de horario).
 * `desde` y `hasta` son `YYYY-MM-DD`, `hasta >= desde` y el rango abarca como máximo 8 días inclusive.
 */
export function ventanaLocal(desde: string, hasta: string, zona: string): VentanaLocal {
  if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) return { error: 'Fecha inválida' };
  const d = DateTime.fromISO(desde, { zone: zona }).startOf('day');
  const h = DateTime.fromISO(hasta, { zone: zona }).startOf('day');
  if (!d.isValid || !h.isValid) return { error: 'Fecha inválida' };
  const dias = Math.round(h.diff(d, 'days').days) + 1;
  if (dias < 1 || dias > MAX_DIAS_VENTANA) return { error: `El rango debe ser de 1 a ${MAX_DIAS_VENTANA} días` };
  return { inicioUtc: d.toUTC().toJSDate(), finUtc: h.plus({ days: 1 }).startOf('day').toUTC().toJSDate() };
}
