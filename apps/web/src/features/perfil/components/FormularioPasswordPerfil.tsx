'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { cambiarPassword } from '@/features/sesion/actions';
import { AvisoDeError, Campo } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';

/** Cambio de contraseña desde el perfil: misma acción que la pantalla obligatoria (al terminar vuelve a la agenda). */
export function FormularioPasswordPerfil() {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(cambiarPassword, {});
  return (
    <form action={accion} className="grid max-w-xl gap-4" noValidate aria-label="Cambiar contraseña">
      <AvisoDeError mensaje={estado.mensaje} />
      <Campo nombre="actual" etiqueta="Contraseña actual" type="password" autoComplete="current-password" error={estado.errores?.actual} />
      <Campo nombre="nueva" etiqueta="Contraseña nueva" type="password" autoComplete="new-password" error={estado.errores?.nueva} />
      <Campo nombre="confirmacion" etiqueta="Confirma la contraseña nueva" type="password" autoComplete="new-password" error={estado.errores?.confirmacion} />
      <Button type="submit" disabled={enviando} className="w-fit">
        {enviando ? 'Guardando…' : 'Cambiar contraseña'}
      </Button>
    </form>
  );
}
