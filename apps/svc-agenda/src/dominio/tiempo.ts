import { DateTime } from 'luxon';
import type { Rango } from './tipos.js';

/** Rango de una cita: `fin = inicio + duracionMin`, normalizado a UTC. */
export function rangoDeCita(inicioIso: string, duracionMin: number): Rango {
  const inicio = DateTime.fromISO(inicioIso, { setZone: true }).toUTC();
  if (!inicio.isValid) throw new Error(`Fecha de inicio inválida: ${inicioIso}`);
  if (!Number.isInteger(duracionMin) || duracionMin <= 0) throw new Error('La duración debe ser un entero positivo');
  return { inicio, fin: inicio.plus({ minutes: duracionMin }) };
}

/** Minutos desde medianoche de un 'HH:mm' ya validado. */
export function minutosDelDia(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

/** Luxon: 1 = lunes … 7 = domingo. El esquema usa 0 = domingo … 6 = sábado. */
export function diaSemanaLocal(d: DateTime): number {
  return d.weekday % 7;
}
