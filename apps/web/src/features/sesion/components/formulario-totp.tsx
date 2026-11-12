'use client';

import { useActionState } from 'react';
import { verificarTotp } from '../actions';
import type { EstadoFormulario } from '../tipos';
import { BotonEnviar } from './boton-enviar';
import { AvisoDeError, Campo } from './campo';
import { MarcoEntrada } from './marco-entrada';

export function FormularioTotp() {
  const [estado, accion] = useActionState<EstadoFormulario, FormData>(verificarTotp, {});
  return (
    <MarcoEntrada titulo="Verificación en dos pasos" descripcion="Escribe el código de 6 dígitos de tu aplicación de autenticación.">
      <form action={accion} className="grid gap-4" noValidate>
        <AvisoDeError mensaje={estado.mensaje} />
        <Campo
          nombre="codigo"
          etiqueta="Código de verificación"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
          error={estado.errores?.codigo}
        />
        <BotonEnviar enviando="Verificando…">Verificar</BotonEnviar>
      </form>
    </MarcoEntrada>
  );
}
