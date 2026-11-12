import type { DateTime } from 'luxon';

/** Rango semiabierto `[inicio, fin)`, ambos extremos en UTC. */
export interface Rango {
  inicio: DateTime;
  fin: DateTime;
}

/** Bloque semanal en hora local del consultorio. `diaSemana`: 0 = domingo … 6 = sábado. */
export interface BloqueHorario {
  diaSemana: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  horaInicio: string; // 'HH:mm'
  horaFin: string; // 'HH:mm'
}

export type EstadoCita = 'agendada' | 'confirmada' | 'atendida' | 'cancelada' | 'no_asistio';
