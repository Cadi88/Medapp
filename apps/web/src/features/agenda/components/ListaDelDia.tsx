'use client';

import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ETIQUETA_ESTADO } from '../logica/estados';
import { formatearDia, formatearRango, sumarDias } from '../logica/formato';

interface Props {
  citas: Cita[];
  medicos: MedicoAgenda[];
  tipos: TipoCita[];
  zona: string;
  /** Día mostrado, `YYYY-MM-DD` en la zona del consultorio. */
  fecha: string;
  onFecha: (fecha: string) => void;
  onSeleccionar: (cita: Cita) => void;
  onNueva: () => void;
}

/** Vista móvil (< 768 px): las citas del día ordenadas por hora. */
export function ListaDelDia({ citas, medicos, tipos, zona, fecha, onFecha, onSeleccionar, onNueva }: Props) {
  const ordenadas = [...citas].sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
  const nombreMedico = new Map(medicos.map((m) => [m.usuarioId, m.nombre]));
  const nombreTipo = new Map(tipos.map((t) => [t.id, t.nombre]));

  return (
    <section className="grid gap-4" aria-label="Citas del día">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="icon" aria-label="Día anterior" onClick={() => onFecha(sumarDias(fecha, -1))}>
          <ChevronLeft />
        </Button>
        <h2 className="text-center text-base font-semibold capitalize">{formatearDia(fecha)}</h2>
        <Button type="button" variant="outline" size="icon" aria-label="Día siguiente" onClick={() => onFecha(sumarDias(fecha, 1))}>
          <ChevronRight />
        </Button>
      </div>
      <Button type="button" onClick={onNueva}>
        Nueva cita
      </Button>
      {ordenadas.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No hay citas este día</p>
      ) : (
        <ul className="grid gap-2">
          {ordenadas.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSeleccionar(c)}
                className="grid w-full gap-1 rounded-md border p-3 text-left hover:bg-accent focus-visible:ring-2"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.contacto.nombre}</span>
                  <Badge variant="secondary">{ETIQUETA_ESTADO[c.estado]}</Badge>
                </span>
                <span className="text-sm text-muted-foreground">{formatearRango(c.inicio, c.fin, zona)}</span>
                <span className="text-sm text-muted-foreground">
                  {[nombreTipo.get(c.tipoCitaId), nombreMedico.get(c.medicoId)].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
