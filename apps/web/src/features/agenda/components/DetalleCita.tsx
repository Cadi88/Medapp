'use client';

import type { Cita, EstadoCitaDto } from '@consultorio/contracts';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AvisoDeError } from '@/features/sesion/components/campo';
import { cambiarEstadoCita } from '../actions';
import { ACCION_ESTADO, ETIQUETA_ESTADO, esReprogramable, estadosSiguientes } from '../logica/estados';
import { formatearRango } from '../logica/formato';

interface Props {
  cita: Cita;
  /** Nombre del médico y del tipo de cita (la cita solo trae sus ids). */
  medico: string;
  tipo: string;
  zona: string;
  /** La cita cambió (o quedó desactualizada): quien la muestra debe recargar. */
  onCambio: () => void;
  onReprogramar: () => void;
}

/** Datos de la cita y solo las acciones que svc-agenda permite desde su estado actual. */
export function DetalleCita({ cita, medico, tipo, zona, onCambio, onReprogramar }: Props) {
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const siguientes = estadosSiguientes(cita.estado);

  async function cambiar(estado: EstadoCitaDto) {
    setEnviando(true);
    setError(undefined);
    try {
      const r = await cambiarEstadoCita({ citaId: cita.id, version: cita.version, estado });
      if ('ok' in r && r.ok) return onCambio();
      setError('mensaje' in r ? r.mensaje : undefined);
      if ('recargar' in r && r.recargar) onCambio();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid gap-4">
      <AvisoDeError mensaje={error} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold">{cita.contacto.nombre}</p>
        <Badge variant="secondary">{ETIQUETA_ESTADO[cita.estado]}</Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Cuándo</dt>
        <dd>{formatearRango(cita.inicio, cita.fin, zona)}</dd>
        <dt className="text-muted-foreground">Médico</dt>
        <dd>{medico}</dd>
        <dt className="text-muted-foreground">Tipo</dt>
        <dd>{tipo}</dd>
        <dt className="text-muted-foreground">Teléfono</dt>
        <dd>{cita.contacto.telefono}</dd>
        {cita.contacto.email ? (
          <>
            <dt className="text-muted-foreground">Correo</dt>
            <dd>{cita.contacto.email}</dd>
          </>
        ) : null}
        {cita.notas ? (
          <>
            <dt className="text-muted-foreground">Notas</dt>
            <dd>{cita.notas}</dd>
          </>
        ) : null}
        {cita.fueraDeHorario ? (
          <>
            <dt className="text-muted-foreground">Horario</dt>
            <dd>Fuera de la jornada del médico</dd>
          </>
        ) : null}
      </dl>
      {siguientes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {siguientes.map((estado) => (
            <Button key={estado} type="button" variant={estado === 'cancelada' ? 'destructive' : 'outline'} disabled={enviando} onClick={() => void cambiar(estado)}>
              {ACCION_ESTADO[estado]}
            </Button>
          ))}
          {esReprogramable(cita.estado) ? (
            <Button type="button" disabled={enviando} onClick={onReprogramar}>
              Reprogramar
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
