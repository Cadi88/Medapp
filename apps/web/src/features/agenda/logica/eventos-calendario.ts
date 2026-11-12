import type { EventInput } from '@fullcalendar/core';
import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { COLOR_ESTADO, esReprogramable } from './estados';
import { formatearHora } from './formato';

/**
 * Citas → eventos de FullCalendar. Título: contacto y tipo (si se conoce). `start`/`end` van como instantes UTC y
 * FullCalendar los muestra en `timeZone` del consultorio. Solo `agendada` y `confirmada` se pueden arrastrar.
 */
export function citasAEventos(citas: Cita[], medicos: MedicoAgenda[], zona: string, tipos: TipoCita[] = []): EventInput[] {
  const nombreMedico = new Map(medicos.map((m) => [m.usuarioId, m.nombre]));
  const nombreTipo = new Map(tipos.map((t) => [t.id, t.nombre]));
  return citas.map((c) => {
    const tipo = nombreTipo.get(c.tipoCitaId);
    const color = COLOR_ESTADO[c.estado];
    return {
      id: c.id,
      title: tipo ? `${c.contacto.nombre} · ${tipo}` : c.contacto.nombre,
      start: c.inicio,
      end: c.fin,
      backgroundColor: color,
      borderColor: color,
      editable: esReprogramable(c.estado),
      extendedProps: {
        estado: c.estado,
        medico: nombreMedico.get(c.medicoId) ?? '',
        version: c.version,
        horaLocal: formatearHora(c.inicio, zona),
      },
    };
  });
}
