import { transicionPermitida } from './estados.js';
import type { EstadoCita } from './tipos.js';

export type Respuesta = 'confirma' | 'cancela' | 'pide_cambio';

export type Decision =
  | { accion: 'confirmar' | 'cancelar' | 'marcar_cambio' }
  | { accion: 'ignorar'; motivo: 'reprogramada' | 'estado_final' | 'sin_efecto' };

const ESTADOS_FINALES: readonly EstadoCita[] = ['atendida', 'cancelada', 'no_asistio'];

/** Aplica a la respuesta del paciente las mismas reglas de dominio que a las acciones del personal. */
export function decidirRespuesta(
  cita: { estado: EstadoCita; inicio: string; pideCambio: boolean },
  e: { respuesta: Respuesta; inicioCita: string },
): Decision {
  if (Date.parse(cita.inicio) !== Date.parse(e.inicioCita)) return { accion: 'ignorar', motivo: 'reprogramada' };
  if (ESTADOS_FINALES.includes(cita.estado)) return { accion: 'ignorar', motivo: 'estado_final' };
  switch (e.respuesta) {
    case 'confirma':
      return transicionPermitida(cita.estado, 'confirmada') ? { accion: 'confirmar' } : { accion: 'ignorar', motivo: 'sin_efecto' };
    case 'cancela':
      return transicionPermitida(cita.estado, 'cancelada') ? { accion: 'cancelar' } : { accion: 'ignorar', motivo: 'sin_efecto' };
    case 'pide_cambio':
      return cita.pideCambio ? { accion: 'ignorar', motivo: 'sin_efecto' } : { accion: 'marcar_cambio' };
  }
}
