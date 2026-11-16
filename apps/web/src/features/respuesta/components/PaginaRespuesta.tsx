import type { RespuestaPacienteValor, RespuestaPublica } from '@consultorio/contracts';
import { TEXTO_INVALIDO, TEXTO_RESPONDIDA } from '../logica/enlace';
import { FormularioRespuesta } from './FormularioRespuesta';
import { LogoPublico } from './LogoPublico';
import { Telefono } from './Telefono';

interface Props {
  token: string;
  enlace: RespuestaPublica;
  accion?: RespuestaPacienteValor | undefined;
}

/** Contenido de `/r/<token>` según el estado del enlace. No muestra datos de contacto del paciente. */
export function PaginaRespuesta({ token, enlace, accion }: Props) {
  if (enlace.estado === 'invalida') return <p className="text-center text-lg">{TEXTO_INVALIDO}</p>;

  const nombre = enlace.consultorio?.nombre ?? '';
  return (
    <div className="grid gap-6">
      {enlace.consultorio?.tieneLogo ? <LogoPublico token={token} nombre={nombre} /> : null}
      {nombre ? <h1 className="text-center text-2xl font-semibold">{nombre}</h1> : null}
      {enlace.estado === 'respondida' ? (
        <div className="grid gap-2 text-center">
          <p>{TEXTO_RESPONDIDA}</p>
          <Telefono telefono={enlace.telefonoConsultorio} />
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md border p-4 text-sm">
            <dt className="text-muted-foreground">Fecha</dt>
            <dd>{enlace.fecha}</dd>
            <dt className="text-muted-foreground">Hora</dt>
            <dd>{enlace.hora}</dd>
            <dt className="text-muted-foreground">Médico</dt>
            <dd>{enlace.medico}</dd>
          </dl>
          <FormularioRespuesta token={token} accion={accion} telefono={enlace.telefonoConsultorio} />
        </>
      )}
    </div>
  );
}
