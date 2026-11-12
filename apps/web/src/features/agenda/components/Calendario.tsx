'use client';

import type { DatesSetArg, EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core';
import esLocale from '@fullcalendar/core/locales/es';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import luxon3Plugin from '@fullcalendar/luxon3';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { aInstanteUtc } from '../logica/formato';

interface Props {
  eventos: EventInput[];
  /** Zona IANA del consultorio: todo se dibuja en esa zona, no en la del navegador. */
  zona: string;
  /** Rango visible como instantes UTC (`desde` incluido, `hasta` excluido). */
  onRango: (desde: string, hasta: string) => void;
  onSeleccionar: (citaId: string) => void;
  /** Clic en un hueco vacío; recibe el instante UTC del hueco. */
  onHueco: (inicio: string) => void;
  /** Arrastre de una cita; `false` (o un error) revierte el evento a su lugar. */
  onReprogramar: (citaId: string, inicio: string) => Promise<boolean>;
}

const PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin, luxon3Plugin];
const BARRA = { left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek' };

/** Envoltura de FullCalendar: el resto de la agenda no depende de la biblioteca. */
export function Calendario({ eventos, zona, onRango, onSeleccionar, onHueco, onReprogramar }: Props) {
  async function alSoltar(info: EventDropArg) {
    let ok = false;
    try {
      ok = await onReprogramar(info.event.id, aInstanteUtc(info.event.startStr));
    } catch {
      ok = false;
    }
    if (!ok) info.revert();
  }

  return (
    <FullCalendar
      plugins={PLUGINS}
      locales={[esLocale]}
      locale="es"
      timeZone={zona}
      initialView="timeGridDay"
      headerToolbar={BARRA}
      events={eventos}
      editable
      eventDurationEditable={false}
      allDaySlot={false}
      nowIndicator
      slotMinTime="07:00:00"
      slotMaxTime="21:00:00"
      scrollTime="08:00:00"
      slotDuration="00:30:00"
      expandRows
      height="auto"
      datesSet={(a: DatesSetArg) => onRango(aInstanteUtc(a.startStr), aInstanteUtc(a.endStr))}
      eventClick={(a: EventClickArg) => onSeleccionar(a.event.id)}
      dateClick={(a: DateClickArg) => onHueco(aInstanteUtc(a.dateStr))}
      eventDrop={alSoltar}
    />
  );
}
