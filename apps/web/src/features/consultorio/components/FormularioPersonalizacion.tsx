'use client';

import { reglasDe, type Consultorio } from '@consultorio/contracts';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AvisoDeError, Campo } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { guardarPersonalizacion } from '../actions';
import { errorDeColor, errorDeNombreComercial, MAX_DIRECCION, MAX_NOMBRE_COMERCIAL, telefonoParaMostrar } from '../logica/formulario';
import { SelectorColor } from './SelectorColor';
import { VistaPreviaEncabezado } from './VistaPreviaEncabezado';

/** Nombre comercial, dirección, teléfono y color, con vista previa en vivo. El logo va aparte (`SeccionLogo`). */
export function FormularioPersonalizacion({ consultorio }: { consultorio: Consultorio }) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(guardarPersonalizacion, {});
  const v = estado.valores;
  const [nombre, setNombre] = useState(consultorio.nombreComercial ?? '');
  const [color, setColor] = useState(consultorio.colorPrimario ?? '');
  const mostrado = nombre.trim() || consultorio.nombre;
  const errorNombre = errorDeNombreComercial(nombre);

  return (
    <form action={accion} className="grid max-w-xl gap-4" noValidate>
      <AvisoDeError mensaje={estado.mensaje} />
      <Campo
        nombre="nombreComercial"
        etiqueta="Nombre comercial"
        placeholder={consultorio.nombre}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        maxLength={MAX_NOMBRE_COMERCIAL}
        error={errorNombre ?? estado.errores?.nombreComercial}
      />
      <Campo
        nombre="direccion"
        etiqueta="Dirección"
        defaultValue={v?.direccion ?? consultorio.direccion ?? ''}
        maxLength={MAX_DIRECCION}
        error={estado.errores?.direccion}
      />
      <Campo
        nombre="telefono"
        etiqueta="Teléfono"
        type="tel"
        autoComplete="off"
        prefijo={reglasDe(consultorio.pais).prefijoTelefonico}
        defaultValue={telefonoParaMostrar(v?.telefono ?? consultorio.telefono, consultorio.pais)}
        error={estado.errores?.telefono}
      />
      <SelectorColor valor={color} onCambio={setColor} error={estado.errores?.colorPrimario} />
      <VistaPreviaEncabezado nombre={mostrado} consultorioId={consultorio.id} logoVersion={consultorio.logoVersion} color={color} />
      {estado.ok ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cambios guardados
        </p>
      ) : null}
      <Button type="submit" disabled={enviando || errorDeColor(color) !== undefined || errorNombre !== undefined} className="w-fit">
        {enviando ? 'Guardando…' : 'Guardar cambios'}
      </Button>
    </form>
  );
}
