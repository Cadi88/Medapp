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

/** Solo se reprograma una cita viva; al hacerlo vuelve a `agendada`. */
export function puedeReprogramar(estado: EstadoCita): boolean {
  return estado === 'agendada' || estado === 'confirmada';
}
