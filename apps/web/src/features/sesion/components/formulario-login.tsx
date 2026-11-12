'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { iniciarSesion } from '../actions';
import type { EstadoFormulario } from '../tipos';
import { BotonEnviar } from './boton-enviar';
import { AvisoDeError, Campo } from './campo';
import { MarcoEntrada } from './marco-entrada';

export function FormularioLogin() {
  const [estado, accion] = useActionState<EstadoFormulario, FormData>(iniciarSesion, {});
  return (
    <MarcoEntrada titulo="Iniciar sesión" descripcion="Accede a la agenda de tu consultorio.">
      <form action={accion} className="grid gap-4" noValidate>
        <AvisoDeError mensaje={estado.mensaje} />
        <Campo
          nombre="email"
          etiqueta="Correo electrónico"
          type="email"
          autoComplete="username"
          defaultValue={estado.valores?.email}
          error={estado.errores?.email}
        />
        <Campo nombre="password" etiqueta="Contraseña" type="password" autoComplete="current-password" error={estado.errores?.password} />
        <BotonEnviar enviando="Entrando…">Iniciar sesión</BotonEnviar>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        ¿Aún no tienes cuenta?{' '}
        <Link href="/registro" className="text-primary underline-offset-4 hover:underline">
          Registra tu consultorio
        </Link>
      </p>
    </MarcoEntrada>
  );
}
