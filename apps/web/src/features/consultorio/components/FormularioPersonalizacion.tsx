'use client';

import type { Consultorio } from '@consultorio/contracts';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AvisoDeError, Campo } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { guardarPersonalizacion } from '../actions';
import { errorDeColor } from '../logica/formulario';
import { SelectorColor } from './SelectorColor';
import { VistaPreviaEncabezado } from './VistaPreviaEncabezado';

/** Nombre comercial, dirección, teléfono y color, con vista previa en vivo. El logo va aparte (`SeccionLogo`). */
export function FormularioPersonalizacion({ consultorio }: { consultorio: Consultorio }) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(guardarPersonalizacion, {});
  const v = estado.valores;
  const [nombre, setNombre] = useState(consultorio.nombreComercial ?? '');
  const [color, setColor] = useState(consultorio.colorPrimario ?? '');
  const mostrado = nombre.trim() || consultorio.nombre;

  return (
    <form action={accion} className="grid max-w-xl gap-4" noValidate>
      <AvisoDeError mensaje={estado.mensaje} />
      <Campo
        nombre="nombreComercial"
        etiqueta="Nombre comercial"
        placeholder={consultorio.nombre}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        error={estado.errores?.nombreComercial}
      />
      <Campo nombre="direccion" etiqueta="Dirección" defaultValue={v?.direccion ?? consultorio.direccion ?? ''} error={estado.errores?.direccion} />
      <Campo
        nombre="telefono"
        etiqueta="Teléfono"
        type="tel"
        autoComplete="off"
        defaultValue={v?.telefono ?? consultorio.telefono ?? ''}
        error={estado.errores?.telefono}
      />
      <SelectorColor valor={color} onCambio={setColor} error={estado.errores?.colorPrimario} />
      <VistaPreviaEncabezado nombre={mostrado} consultorioId={consultorio.id} logoVersion={consultorio.logoVersion} color={color} />
      {estado.ok ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cambios guardados
        </p>
      ) : null}
      <Button type="submit" disabled={enviando || errorDeColor(color) !== undefined} className="w-fit">
        {enviando ? 'Guardando…' : 'Guardar cambios'}
      </Button>
    </form>
  );
}
