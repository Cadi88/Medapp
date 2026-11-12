'use client';

import { useActionState } from 'react';
import { cambiarPassword } from '../actions';
import type { EstadoFormulario } from '../tipos';
import { BotonEnviar } from './boton-enviar';
import { AvisoDeError, Campo } from './campo';
import { MarcoEntrada } from './marco-entrada';

export function FormularioCambiarPassword() {
  const [estado, accion] = useActionState<EstadoFormulario, FormData>(cambiarPassword, {});
  return (
    <MarcoEntrada titulo="Cambia tu contraseña" descripcion="Tu contraseña es temporal: elige una nueva para continuar.">
      <form action={accion} className="grid gap-4" noValidate>
        <AvisoDeError mensaje={estado.mensaje} />
        <Campo nombre="actual" etiqueta="Contraseña actual" type="password" autoComplete="current-password" error={estado.errores?.actual} />
        <Campo nombre="nueva" etiqueta="Contraseña nueva" type="password" autoComplete="new-password" error={estado.errores?.nueva} />
        <Campo nombre="confirmacion" etiqueta="Confirma la contraseña nueva" type="password" autoComplete="new-password" error={estado.errores?.confirmacion} />
        <BotonEnviar enviando="Guardando…">Cambiar contraseña</BotonEnviar>
      </form>
    </MarcoEntrada>
  );
}
