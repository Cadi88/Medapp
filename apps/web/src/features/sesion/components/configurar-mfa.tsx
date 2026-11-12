'use client';

import { useActionState } from 'react';
import { confirmarMfa, iniciarConfiguracionMfa } from '../actions';
import type { EstadoConfiguracionMfa, EstadoFormulario } from '../tipos';
import { BotonEnviar } from './boton-enviar';
import { AvisoDeError, Campo } from './campo';
import { MarcoEntrada } from './marco-entrada';

export function ConfigurarMfa() {
  const [inicio, iniciar] = useActionState<EstadoConfiguracionMfa, FormData>(iniciarConfiguracionMfa, {});
  const [confirmacion, confirmar] = useActionState<EstadoFormulario, FormData>(confirmarMfa, {});

  if (!inicio.qrSvg) {
    return (
      <MarcoEntrada titulo="Protege tu cuenta" descripcion="Activa la verificación en dos pasos con una aplicación de autenticación.">
        <form action={iniciar} className="grid gap-4" noValidate>
          <AvisoDeError mensaje={inicio.mensaje} />
          <Campo nombre="password" etiqueta="Contraseña" type="password" autoComplete="current-password" error={inicio.errores?.password} />
          <BotonEnviar enviando="Generando…">Generar código QR</BotonEnviar>
        </form>
      </MarcoEntrada>
    );
  }

  return (
    <MarcoEntrada titulo="Escanea el código QR" descripcion="Escanéalo con tu aplicación de autenticación y escribe el código que muestra.">
      {/* El SVG lo genera el servidor a partir del URI TOTP: no contiene contenido del usuario. */}
      <div className="mx-auto w-48 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: inicio.qrSvg }} />
      <section aria-labelledby="respaldo" className="grid gap-2">
        <h2 id="respaldo" className="text-sm font-medium">
          Códigos de respaldo
        </h2>
        <p className="text-sm text-muted-foreground">Guárdalos en un lugar seguro: cada uno sirve una vez si pierdes tu dispositivo.</p>
        <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
          {inicio.codigosRespaldo?.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>
      <form action={confirmar} className="grid gap-4" noValidate>
        <AvisoDeError mensaje={confirmacion.mensaje} />
        <Campo
          nombre="codigo"
          etiqueta="Código de verificación"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          error={confirmacion.errores?.codigo}
        />
        <BotonEnviar enviando="Verificando…">Confirmar y continuar</BotonEnviar>
      </form>
    </MarcoEntrada>
  );
}
