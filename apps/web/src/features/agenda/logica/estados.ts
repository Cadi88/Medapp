import type { EstadoCitaDto } from '@consultorio/contracts';

export const ETIQUETA_ESTADO: Record<EstadoCitaDto, string> = {
  agendada: 'Agendada',
  confirmada: 'Confirmada',
  atendida: 'Atendida',
  no_asistio: 'No asistió',
  cancelada: 'Cancelada',
};

export const COLOR_ESTADO: Record<EstadoCitaDto, string> = {
  agendada: '#2563eb',
  confirmada: '#16a34a',
  atendida: '#6b7280',
  no_asistio: '#d97706',
  cancelada: '#dc2626',
};

/** Textos del botón que lleva a cada estado. */
export const ACCION_ESTADO: Record<EstadoCitaDto, string> = {
  agendada: 'Agendada',
  confirmada: 'Confirmar',
  atendida: 'Marcar atendida',
  no_asistio: 'No asistió',
  cancelada: 'Cancelar cita',
};

const SIGUIENTES: Record<EstadoCitaDto, EstadoCitaDto[]> = {
  agendada: ['confirmada', 'atendida', 'no_asistio', 'cancelada'],
  confirmada: ['atendida', 'no_asistio', 'cancelada'],
  atendida: [],
  no_asistio: [],
  cancelada: [],
};

/** Transiciones que acepta svc-agenda desde `estado`; los estados finales no tienen ninguna. */
export function estadosSiguientes(estado: EstadoCitaDto): EstadoCitaDto[] {
  return SIGUIENTES[estado];
}

/** Arrastrar o reprogramar solo aplica a citas que aún no se resolvieron. */
export function esReprogramable(estado: EstadoCitaDto): boolean {
  return estado === 'agendada' || estado === 'confirmada';
}
