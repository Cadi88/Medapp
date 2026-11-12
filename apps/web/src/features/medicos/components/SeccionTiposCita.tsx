'use client';

import type { TipoCita } from '@consultorio/contracts';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AvisoDeError, Campo, MensajeDeCampo } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { crearTipoCita, editarTipoCita } from '../actions';

function FilaTipo({ tipo }: { tipo: TipoCita }) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(editarTipoCita, {});
  return (
    <li className="grid gap-1">
      <form action={accion} className="flex flex-wrap items-center gap-3" aria-label={`Editar ${tipo.nombre}`} noValidate>
        <input type="hidden" name="medicoId" value={tipo.medicoId} />
        <input type="hidden" name="tipoId" value={tipo.id} />
        <Input name="nombre" aria-label={`Nombre de ${tipo.nombre}`} defaultValue={tipo.nombre} className="w-56" />
        <Input name="duracionMin" type="number" min={5} max={480} aria-label={`Duración de ${tipo.nombre}`} defaultValue={tipo.duracionMin} className="w-24" />
        <span className="text-sm text-muted-foreground">min</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="activo" defaultChecked={tipo.activo} />
          Activo
        </label>
        <Button type="submit" size="sm" disabled={enviando}>
          Guardar
        </Button>
      </form>
      <AvisoDeError mensaje={estado.mensaje} />
      <MensajeDeCampo id={`error-${tipo.id}`}>{estado.errores?.nombre ?? estado.errores?.duracionMin}</MensajeDeCampo>
    </li>
  );
}

/** Tipos de cita del médico (con su duración). Un tipo se desactiva en lugar de borrarse: las citas viejas lo conservan. */
export function SeccionTiposCita({ medicoId, tipos }: { medicoId: string; tipos: TipoCita[] }) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(crearTipoCita, {});
  return (
    <div className="grid gap-6">
      {tipos.length === 0 ? (
        <p className="text-muted-foreground">Este médico aún no tiene tipos de cita</p>
      ) : (
        <ul className="grid gap-3" aria-label="Tipos de cita">
          {tipos.map((t) => (
            <FilaTipo key={t.id} tipo={t} />
          ))}
        </ul>
      )}
      <form action={accion} className="grid max-w-md gap-3" noValidate aria-label="Nuevo tipo de cita">
        <input type="hidden" name="medicoId" value={medicoId} />
        <AvisoDeError mensaje={estado.mensaje} />
        <Campo nombre="nombre" etiqueta="Nombre del tipo" defaultValue={estado.valores?.nombre} error={estado.errores?.nombre} />
        <Campo nombre="duracionMin" etiqueta="Duración (min)" type="number" defaultValue={estado.valores?.duracionMin} error={estado.errores?.duracionMin} />
        <Button type="submit" disabled={enviando} className="w-fit">
          Agregar tipo
        </Button>
      </form>
    </div>
  );
}
