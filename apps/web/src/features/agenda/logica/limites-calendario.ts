import { DateTime } from 'luxon';

export interface LimitesCalendario {
  slotMinTime: string;
  slotMaxTime: string;
}

/** Franja visible por omisión (hora local del consultorio), en minutos desde la medianoche. */
const MIN_POR_OMISION = 7 * 60;
const MAX_POR_OMISION = 21 * 60;
const DIA = 24 * 60;

const aHora = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, '0')}:00:00`;

/**
 * Franja de horas que dibuja la vista de día/semana: 07:00–21:00, ampliada a horas completas para que ninguna cita
 * visible quede fuera (una cita a las 21:30 lleva el final a las 22:00; una a las 06:30, el inicio a las 06:00).
 * Una cita que cruza la medianoche local abre el día completo.
 */
export function limitesDelCalendario(citas: readonly { inicio: string; fin: string }[], zona: string): LimitesCalendario {
  let min = MIN_POR_OMISION;
  let max = MAX_POR_OMISION;
  for (const c of citas) {
    const inicio = DateTime.fromISO(c.inicio, { zone: zona });
    const fin = DateTime.fromISO(c.fin, { zone: zona });
    const finEnMinutos = fin.diff(inicio.startOf('day'), 'minutes').minutes;
    if (finEnMinutos > DIA) {
      min = 0;
      max = DIA;
      continue;
    }
    min = Math.min(min, Math.floor((inicio.hour * 60 + inicio.minute) / 60) * 60);
    max = Math.max(max, Math.ceil(finEnMinutos / 60) * 60);
  }
  return { slotMinTime: aHora(min), slotMaxTime: aHora(max) };
}
