'use client';

import type { RecordatoriosRespuesta } from '@consultorio/contracts';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatearDia } from '@/features/agenda/logica/formato';
import { AvisoDeError } from '@/features/sesion/components/campo';
import { aprobarTodos } from '../actions';
import { ETIQUETA_MODO } from '@/features/consultorio/logica/plantillas';
import { agruparPorFechaYMedico, hayPendientes } from '../logica/presentacion';
import { FilaRecordatorio, type Ejecutar } from './FilaRecordatorio';

const MENSAJE_GENERICO = 'Ocurrió un error. Intenta de nuevo.';

interface Props {
  datos: RecordatoriosRespuesta;
  /** Rango que se pidió (fechas locales); "Aprobar todos" aprueba exactamente ese. */
  desde: string;
  hasta: string;
  zona: string;
}

/** Recordatorios de mañana y los dos días siguientes, por fecha y médico, con modo y hora de envío arriba. */
export function PanelRecordatorios({ datos, desde, hasta, zona }: Props) {
  const [error, setError] = useState<string>();
  const [ocupado, setOcupado] = useState(false);
  const grupos = agruparPorFechaYMedico(datos.citas);

  const ejecutar: Ejecutar = async (accion) => {
    setOcupado(true);
    setError(undefined);
    try {
      const r = await accion();
      if ('mensaje' in r) setError(r.mensaje);
    } catch {
      setError(MENSAJE_GENERICO);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <p>
          <span className="font-medium">{ETIQUETA_MODO[datos.modo]}</span>
          <span className="text-muted-foreground"> · se envía a las </span>
          <span data-testid="hora-envio">{datos.horaEnvio}</span>
          <span className="text-muted-foreground"> del día anterior</span>
        </p>
        {hayPendientes(datos.citas) ? (
          <Button type="button" disabled={ocupado} onClick={() => void ejecutar(() => aprobarTodos(desde, hasta))}>
            Aprobar todos
          </Button>
        ) : null}
      </div>
      <AvisoDeError mensaje={error} />
      {grupos.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No hay citas con recordatorio en estos días</p>
      ) : (
        grupos.map((g) => (
          <section key={g.fecha} className="grid gap-4" aria-label={formatearDia(g.fecha)}>
            <h2 className="text-lg font-semibold capitalize">{formatearDia(g.fecha)}</h2>
            {g.medicos.map((m) => (
              <div key={m.medico} className="grid gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">{m.medico}</h3>
                <ul className="grid gap-2">
                  {m.citas.map((c) => (
                    <FilaRecordatorio key={c.citaId} cita={c} zona={zona} ejecutar={ejecutar} ocupado={ocupado} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
