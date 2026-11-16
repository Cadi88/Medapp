'use client';

import type { RespuestaPacienteValor } from '@consultorio/contracts';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AvisoDeError } from '@/features/sesion/components/campo';
import { enviarRespuesta } from '../actions';
import { OPCIONES_RESPUESTA, TEXTO_GRACIAS, TEXTO_INVALIDO, TEXTO_RESPONDIDA } from '../logica/enlace';
import type { EstadoRespuesta } from '../tipos';
import { Telefono } from './Telefono';

interface Props {
  token: string;
  /** Viene del `?accion=` del correo: solo preselecciona; el registro ocurre únicamente al enviar. */
  accion: RespuestaPacienteValor | undefined;
  telefono: string | undefined;
}

export function FormularioRespuesta({ token, accion, telefono }: Props) {
  const [estado, enviar, enviando] = useActionState<EstadoRespuesta, FormData>(enviarRespuesta, {});
  const [eleccion, setEleccion] = useState<RespuestaPacienteValor | undefined>(accion);

  if (estado.estado === 'registrada') return <p role="status" className="text-center font-medium">{TEXTO_GRACIAS}</p>;
  if (estado.estado === 'invalida') return <p role="status" className="text-center">{TEXTO_INVALIDO}</p>;
  if (estado.estado === 'respondida') {
    return (
      <div role="status" className="grid gap-2 text-center">
        <p>{TEXTO_RESPONDIDA}</p>
        <Telefono telefono={telefono} />
      </div>
    );
  }

  return (
    <form action={enviar} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <AvisoDeError mensaje={estado.mensaje} />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">¿Qué quieres hacer con tu cita?</legend>
        {OPCIONES_RESPUESTA.map((o) => (
          <label key={o.valor} className="flex items-center gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-accent">
            <input type="radio" name="respuesta" value={o.valor} checked={eleccion === o.valor} onChange={() => setEleccion(o.valor)} />
            {o.etiqueta}
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={enviando || eleccion === undefined}>
        {enviando ? 'Enviando…' : 'Enviar respuesta'}
      </Button>
    </form>
  );
}
