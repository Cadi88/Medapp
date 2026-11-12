import { DateTime } from 'luxon';

const LOCALE = 'es-MX';

/** "jue 12 nov, 10:00–10:30" en la zona del consultorio. */
export function formatearRango(inicio: string, fin: string, zona: string): string {
  const dia = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: zona }).format(new Date(inicio));
  return `${dia}, ${formatearHora(inicio, zona)}–${formatearHora(fin, zona)}`;
}

/** "10:00" (24 h) en la zona del consultorio. */
export function formatearHora(instante: string, zona: string): string {
  return DateTime.fromISO(instante, { zone: zona }).setLocale(LOCALE).toFormat('HH:mm');
}

/** Día calendario `YYYY-MM-DD` que le corresponde al instante en la zona del consultorio. */
export function fechaLocal(instante: string, zona: string): string {
  return DateTime.fromISO(instante, { zone: zona }).toISODate() ?? '';
}

/** Día local `[00:00, 00:00 siguiente)` como instantes UTC; correcto también en días de cambio de horario. */
export function rangoDelDia(fecha: string, zona: string): { desde: string; hasta: string } {
  const inicio = DateTime.fromISO(fecha, { zone: zona }).startOf('day');
  return { desde: inicio.toUTC().toISO() ?? '', hasta: inicio.plus({ days: 1 }).startOf('day').toUTC().toISO() ?? '' };
}

/** Fecha `YYYY-MM-DD` y hora `HH:mm` locales del consultorio como instante UTC (`...Z`); `''` si alguna no es válida. */
export function instanteLocal(fecha: string, hora: string, zona: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return '';
  const dt = DateTime.fromISO(`${fecha}T${hora}`, { zone: zona });
  return dt.isValid ? (dt.toUTC().toISO() ?? '') : '';
}

/** Suma `dias` (puede ser negativo) a un día `YYYY-MM-DD`. */
export function sumarDias(fecha: string, dias: number): string {
  return DateTime.fromISO(fecha, { zone: 'utc' }).plus({ days: dias }).toISODate() ?? fecha;
}

/** Texto largo del día para la lista móvil: "jueves, 12 de noviembre". */
export function formatearDia(fecha: string): string {
  return DateTime.fromISO(fecha, { zone: 'utc' }).setLocale(LOCALE).toFormat("cccc, d 'de' LLLL");
}

/** Cualquier ISO 8601 con desfase (lo que entrega FullCalendar) como instante UTC (`...Z`). */
export function aInstanteUtc(iso: string): string {
  return new Date(iso).toISOString();
}
