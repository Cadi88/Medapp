'use client';

import type { PerfilMedicoVista } from '@consultorio/contracts';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { AvisoDeError, Campo } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { guardarPerfilMedico } from '../actions';

export function FormularioPerfilMedico({ perfil }: { perfil: PerfilMedicoVista | null }) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(guardarPerfilMedico, {});
  const v = estado.valores;
  return (
    <form action={accion} className="grid max-w-xl gap-4" noValidate aria-label="Perfil profesional">
      <AvisoDeError mensaje={estado.mensaje} />
      {estado.ok ? <p role="status" className="text-sm text-muted-foreground">Perfil guardado</p> : null}
      <Campo
        nombre="cedulaProfesional"
        etiqueta="Cédula profesional"
        inputMode="numeric"
        defaultValue={v?.cedulaProfesional ?? perfil?.cedulaProfesional ?? ''}
        error={estado.errores?.cedulaProfesional}
      />
      <Campo nombre="especialidad" etiqueta="Especialidad" defaultValue={v?.especialidad ?? perfil?.especialidad ?? ''} error={estado.errores?.especialidad} />
      <Campo
        nombre="cedulaEspecialidad"
        etiqueta="Cédula de especialidad"
        defaultValue={v?.cedulaEspecialidad ?? perfil?.cedulaEspecialidad ?? ''}
        error={estado.errores?.cedulaEspecialidad}
      />
      <Campo nombre="institucion" etiqueta="Institución" defaultValue={v?.institucion ?? perfil?.institucion ?? ''} error={estado.errores?.institucion} />
      <Button type="submit" disabled={enviando} className="w-fit">
        {enviando ? 'Guardando…' : 'Guardar perfil'}
      </Button>
    </form>
  );
}
