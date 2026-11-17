'use client';

import type { RecordatorioCita, RespuestaPacienteValor } from '@consultorio/contracts';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ETIQUETA_PIDE_CAMBIO } from '@/features/agenda/logica/estados';
import { formatearHora } from '@/features/agenda/logica/formato';
import { abrirWhatsApp, aprobarRecordatorio, registrarRespuestaRecepcion, reintentarEnvio } from '../actions';
import { ETIQUETA_RESPUESTA, textoCorreo, textoRespuesta, textoWhatsApp } from '../logica/presentacion';
import type { ResultadoRecordatorio, ResultadoWhatsApp } from '../tipos';

export type Ejecutar = (accion: () => Promise<ResultadoRecordatorio | ResultadoWhatsApp>) => Promise<void>;

interface Props {
  cita: RecordatorioCita;
  zona: string;
  /** Corre la acción, avisa si falló y evita que se lance otra mientras tanto. */
  ejecutar: Ejecutar;
  ocupado: boolean;
}

const RESPUESTAS: RespuestaPacienteValor[] = ['confirma', 'cancela', 'pide_cambio'];

/** Una cita: hora, paciente, estado del correo y del WhatsApp, vistas previas y las acciones que le tocan. */
export function FilaRecordatorio({ cita, zona, ejecutar, ocupado }: Props) {
  const { correo, whatsapp, respuesta } = cita;
  const estadoWhatsApp = textoWhatsApp(whatsapp);
  /** Enlace para tocar cuando el navegador no dejó abrir la pestaña (p. ej. Safari). */
  const [enlaceManual, setEnlaceManual] = useState<string>();

  /** Aprobar y "Enviar ahora" son la misma acción; el servicio es idempotente. */
  const aprobar = () => ejecutar(() => aprobarRecordatorio(cita.citaId));

  /**
   * La pestaña se abre en el clic, antes de esperar al servidor (Safari bloquea las que se abren después de un
   * `await`); se registra y solo entonces se manda a wa.me. Si el registro falla, la pestaña vacía se cierra.
   */
  const abrirEnWhatsApp = () => {
    const pestana = window.open('about:blank', '_blank');
    return ejecutar(async () => {
      try {
        const r = await abrirWhatsApp(cita.citaId, cita.fecha);
        if (!('enlace' in r)) pestana?.close();
        else if (pestana) {
          pestana.opener = null;
          pestana.location.href = r.enlace;
        } else setEnlaceManual(r.enlace);
        return r;
      } catch (error) {
        pestana?.close();
        throw error;
      }
    });
  };

  return (
    <li aria-label={cita.paciente} className="grid gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{formatearHora(cita.inicio, zona)}</span>
        <span className="font-medium">{cita.paciente}</span>
        {cita.pideCambio ? <Badge variant="outline">{ETIQUETA_PIDE_CAMBIO}</Badge> : null}
        {respuesta ? <Badge variant="secondary">{textoRespuesta(respuesta)}</Badge> : null}
      </div>

      <div className="grid gap-1 text-sm">
        <p>
          <span className="text-muted-foreground">Correo: </span>
          <span className={correo.estado === 'fallido' || correo.sinAprobarYVencido ? 'font-medium text-destructive' : undefined}>{textoCorreo(correo)}</span>
        </p>
        {correo.vistaPrevia ? (
          <details>
            <summary className="cursor-pointer text-muted-foreground">Vista previa del correo</summary>
            <p className="mt-1 font-medium">{correo.vistaPrevia.asunto}</p>
            <p className="whitespace-pre-line text-muted-foreground">{correo.vistaPrevia.texto}</p>
          </details>
        ) : null}
        <p>
          <span className="text-muted-foreground">WhatsApp: </span>
          {estadoWhatsApp ?? 'Disponible'}
        </p>
        {whatsapp.vistaPrevia ? (
          <details>
            <summary className="cursor-pointer text-muted-foreground">Vista previa del WhatsApp</summary>
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{whatsapp.vistaPrevia}</p>
          </details>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {correo.estado === 'pendiente' ? (
          <Button type="button" size="sm" disabled={ocupado} onClick={() => void aprobar()}>
            Aprobar
          </Button>
        ) : null}
        {correo.estado === 'aprobado' && correo.enviableAhora ? (
          <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={() => void aprobar()}>
            Enviar ahora
          </Button>
        ) : null}
        {correo.estado === 'fallido' ? (
          <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={() => void ejecutar(() => reintentarEnvio(cita.citaId))}>
            Reintentar
          </Button>
        ) : null}
        {enlaceManual ? (
          <a href={enlaceManual} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent">
            Abrir WhatsApp
          </a>
        ) : whatsapp.enlace ? (
          <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={() => void abrirEnWhatsApp()}>
            Abrir WhatsApp
          </Button>
        ) : null}
        {respuesta
          ? null
          : RESPUESTAS.map((valor) => (
              <Button
                key={valor}
                type="button"
                size="sm"
                variant="ghost"
                disabled={ocupado}
                onClick={() => void ejecutar(() => registrarRespuestaRecepcion(cita.citaId, cita.fecha, valor))}
              >
                {ETIQUETA_RESPUESTA[valor]}
              </Button>
            ))}
      </div>
    </li>
  );
}
