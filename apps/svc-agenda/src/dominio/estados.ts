import type { EstadoCita } from './tipos.js';

const SIGUIENTES: Record<EstadoCita, readonly EstadoCita[]> = {
  agendada: ['confirmada', 'cancelada', 'no_asistio', 'atendida'],
  confirmada: ['atendida', 'cancelada', 'no_asistio'],
  atendida: [],
  cancelada: [],
  no_asistio: [],
};

export function transicionPermitida(de: EstadoCita, a: EstadoCita): boolean {
  return SIGUIENTES[de].includes(a);
}

/** Confirmar la cita (el personal, o recepción en nombre del paciente) cierra el "pide cambio"; los demás estados lo dejan como estaba. */
export function pideCambioTras(estado: EstadoCita, pideCambio: boolean): boolean {
  return estado === 'confirmada' ? false : pideCambio;
}

/** Solo se reprograma una cita viva; al hacerlo vuelve a `agendada`. */
export function puedeReprogramar(estado: EstadoCita): boolean {
  return estado === 'agendada' || estado === 'confirmada';
}
