import type { Cita } from '@consultorio/contracts';
import { DateTime } from 'luxon';
import { fechaLocal, rangoDelDia, sumarDias } from '@/features/agenda/logica/formato';

/** Días después de hoy que cubre "Próximos días". */
export const DIAS_PROXIMOS = 7;

/**
 * Qué pedir a la agenda con una sola consulta: desde las 00:00 de hoy (en la zona del consultorio) hasta el fin del
 * séptimo día siguiente. `hoy` es la fecha local `YYYY-MM-DD`.
 */
export function rangoDeMiDia(ahora: Date, zona: string): { hoy: string; desde: string; hasta: string } {
  const hoy = DateTime.fromJSDate(ahora, { zone: zona }).toISODate() ?? '';
  return { hoy, desde: rangoDelDia(hoy, zona).desde, hasta: rangoDelDia(sumarDias(hoy, DIAS_PROXIMOS), zona).hasta };
}

const porHora = (a: Cita, b: Cita) => Date.parse(a.inicio) - Date.parse(b.inicio);

/**
 * Hoy: todas las citas del día local, en orden y con cualquier estado (así se ve cuáles ya se atendieron).
 * Próximos días: solo las `agendada`, en orden.
 */
export function separarCitas(citas: Cita[], hoy: string, zona: string): { hoy: Cita[]; proximas: Cita[] } {
  const deHoy = citas.filter((c) => fechaLocal(c.inicio, zona) === hoy);
  const proximas = citas.filter((c) => fechaLocal(c.inicio, zona) > hoy && c.estado === 'agendada');
  return { hoy: deHoy.sort(porHora), proximas: proximas.sort(porHora) };
}

export interface DiaDeCitas {
  fecha: string;
  citas: Cita[];
}

/** Las citas (ya en orden) agrupadas por día local. */
export function agruparPorDia(citas: Cita[], zona: string): DiaDeCitas[] {
  const dias: DiaDeCitas[] = [];
  for (const c of citas) {
    const fecha = fechaLocal(c.inicio, zona);
    const ultimo = dias.at(-1);
    if (ultimo?.fecha === fecha) ultimo.citas.push(c);
    else dias.push({ fecha, citas: [c] });
  }
  return dias;
}
