'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { registrarConsultorio } from '../actions';
import type { EstadoFormulario } from '../tipos';
import { ZONA_POR_OMISION, zonasDeAmerica } from '../logica/validaciones';
import { BotonEnviar } from './boton-enviar';
import { AvisoDeError, Campo, MensajeDeCampo } from './campo';
import { MarcoEntrada } from './marco-entrada';

const ZONAS = zonasDeAmerica();

export function FormularioRegistro() {
  const [estado, accion] = useActionState<EstadoFormulario, FormData>(registrarConsultorio, {});
  const v = estado.valores;
  return (
    <MarcoEntrada titulo="Registra tu consultorio" descripcion="Crea la cuenta del consultorio y su primera persona administradora.">
      <form action={accion} className="grid gap-4" noValidate>
        <AvisoDeError mensaje={estado.mensaje} />
        <Campo nombre="nombreConsultorio" etiqueta="Nombre del consultorio" defaultValue={v?.nombreConsultorio} error={estado.errores?.nombreConsultorio} />
        <Campo
          nombre="slug"
          etiqueta="Identificador (slug)"
          placeholder="mi-consultorio"
          autoCapitalize="none"
          defaultValue={v?.slug}
          error={estado.errores?.slug}
        />
        <div className="grid gap-2">
          <label htmlFor="zonaHoraria" className="text-sm font-medium">
            Zona horaria
          </label>
          <select
            key={v?.zonaHoraria}
            id="zonaHoraria"
            name="zonaHoraria"
            defaultValue={v?.zonaHoraria ?? ZONA_POR_OMISION}
            aria-invalid={estado.errores?.zonaHoraria ? true : undefined}
            aria-describedby={estado.errores?.zonaHoraria ? 'zonaHoraria-error' : undefined}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          >
            {ZONAS.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <MensajeDeCampo id="zonaHoraria-error">{estado.errores?.zonaHoraria}</MensajeDeCampo>
        </div>
        <Campo nombre="nombre" etiqueta="Tu nombre" autoComplete="name" defaultValue={v?.nombre} error={estado.errores?.nombre} />
        <Campo nombre="email" etiqueta="Correo electrónico" type="email" autoComplete="username" defaultValue={v?.email} error={estado.errores?.email} />
        <Campo nombre="password" etiqueta="Contraseña" type="password" autoComplete="new-password" error={estado.errores?.password} />
        <div className="flex items-center gap-2">
          <input key={v?.esMedico} id="esMedico" name="esMedico" type="checkbox" defaultChecked={v?.esMedico === 'on'} className="size-4" />
          <label htmlFor="esMedico" className="text-sm">
            Soy médico y atenderé pacientes
          </label>
        </div>
        <BotonEnviar enviando="Creando cuenta…">Crear cuenta</BotonEnviar>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Inicia sesión
        </Link>
      </p>
    </MarcoEntrada>
  );
}
