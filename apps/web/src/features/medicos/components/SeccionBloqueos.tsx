'use client';

import type { Bloqueo } from '@consultorio/contracts';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { AvisoDeError, Campo } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { crearBloqueo, eliminarBloqueo } from '../actions';
import { textoLocal } from '../logica/bloqueos';

function FilaBloqueo({ bloqueo, zona }: { bloqueo: Bloqueo; zona: string }) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(eliminarBloqueo, {});
  return (
    <li className="grid gap-1">
      <form action={accion} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="medicoId" value={bloqueo.medicoId} />
        <input type="hidden" name="bloqueoId" value={bloqueo.id} />
        <span>
          {textoLocal(bloqueo.inicio, zona)} – {textoLocal(bloqueo.fin, zona)}
        </span>
        {bloqueo.motivo ? <span className="text-muted-foreground">{bloqueo.motivo}</span> : null}
        <Button type="submit" variant="outline" size="sm" disabled={enviando}>
          Eliminar bloqueo
        </Button>
      </form>
      <AvisoDeError mensaje={estado.mensaje} />
    </li>
  );
}

/** Periodos en que el médico no atiende (vacaciones, congresos…). Las horas son las del consultorio. */
export function SeccionBloqueos({ medicoId, bloqueos, zona }: { medicoId: string; bloqueos: Bloqueo[]; zona: string }) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(crearBloqueo, {});
  const v = estado.valores;
  return (
    <div className="grid gap-6">
      {bloqueos.length === 0 ? (
        <p className="text-muted-foreground">No hay bloqueos próximos</p>
      ) : (
        <ul className="grid gap-3" aria-label="Bloqueos próximos">
          {bloqueos.map((b) => (
            <FilaBloqueo key={b.id} bloqueo={b} zona={zona} />
          ))}
        </ul>
      )}
      <form action={accion} className="grid max-w-md gap-3" noValidate aria-label="Nuevo bloqueo">
        <input type="hidden" name="medicoId" value={medicoId} />
        <AvisoDeError mensaje={estado.mensaje} />
        <Campo nombre="inicio" etiqueta="Inicio del bloqueo" type="datetime-local" defaultValue={v?.inicio} error={estado.errores?.inicio} />
        <Campo nombre="fin" etiqueta="Fin del bloqueo" type="datetime-local" defaultValue={v?.fin} error={estado.errores?.fin} />
        <Campo nombre="motivo" etiqueta="Motivo (opcional)" defaultValue={v?.motivo} error={estado.errores?.motivo} />
        <Button type="submit" disabled={enviando} className="w-fit">
          Agregar bloqueo
        </Button>
      </form>
    </div>
  );
}
