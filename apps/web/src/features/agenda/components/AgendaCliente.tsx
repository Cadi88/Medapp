'use client';

import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cargarCitas, reprogramarCita } from '../actions';
import { mensajeDeError, MENSAJE_GENERICO } from '../logica/errores';
import { citasAEventos } from '../logica/eventos-calendario';
import { fechaLocal, rangoDelDia } from '../logica/formato';
import { esFueraDeHorario } from '../tipos';
import { Calendario } from './Calendario';
import { DetalleCita } from './DetalleCita';
import { FiltroMedico } from './FiltroMedico';
import { FormularioCita } from './FormularioCita';
import { ListaDelDia } from './ListaDelDia';
import { useEsMovil } from './usar-es-movil';

interface Props {
  medicos: MedicoAgenda[];
  /** Todos los tipos de cita de los médicos visibles, también los inactivos (las citas viejas los usan). */
  tipos: TipoCita[];
  zona: string;
  /** Administración y recepción filtran por médico; un médico ve solo su agenda. */
  puedeFiltrar: boolean;
}

interface Rango {
  desde: string;
  hasta: string;
}

type Formulario = { cita?: Cita; fecha?: string } | null;

const CONFIRMAR_FUERA_DE_HORARIO = 'El nuevo horario queda fuera de la jornada del médico. ¿Reprogramar de todos modos?';

/** Estado de la pantalla de agenda: rango visible, filtro, citas cargadas y diálogos de detalle y formulario. */
export function AgendaCliente({ medicos, tipos, zona, puedeFiltrar }: Props) {
  const esMovil = useEsMovil();
  const [medicoId, setMedicoId] = useState('');
  const [rangoCalendario, setRangoCalendario] = useState<Rango | null>(null);
  const [fecha, setFecha] = useState(() => fechaLocal(new Date().toISOString(), zona));
  const [citas, setCitas] = useState<Cita[]>([]);
  const [recarga, setRecarga] = useState(0);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<Formulario>(null);

  const rango = esMovil ? rangoDelDia(fecha, zona) : rangoCalendario;
  const desde = rango?.desde;
  const hasta = rango?.hasta;
  const recargar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    if (!desde || !hasta) return;
    let vigente = true;
    void cargarCitas(desde, hasta, medicoId || undefined).then((r) => {
      if (!vigente) return;
      if (r.ok) setCitas(r.citas);
      else toast.error(r.mensaje);
    });
    return () => {
      vigente = false;
    };
  }, [desde, hasta, medicoId, recarga]);

  const eventos = useMemo(() => citasAEventos(citas, medicos, zona, tipos), [citas, medicos, zona, tipos]);
  const detalle = citas.find((c) => c.id === detalleId);

  const alCambiarRango = useCallback(
    (d: string, h: string) => setRangoCalendario((previo) => (previo?.desde === d && previo.hasta === h ? previo : { desde: d, hasta: h })),
    [],
  );

  /** Arrastre: `true` si quedó guardada; `false` hace que el calendario regrese la cita a su lugar. */
  async function reprogramarArrastrada(citaId: string, inicio: string): Promise<boolean> {
    const cita = citas.find((c) => c.id === citaId);
    if (!cita) return false;
    const datos = { citaId, version: cita.version, inicio };
    let r = await reprogramarCita(datos);
    if (esFueraDeHorario(r)) {
      if (!confirm(CONFIRMAR_FUERA_DE_HORARIO)) return false;
      r = await reprogramarCita({ ...datos, fueraDeHorario: true });
    }
    if (!esFueraDeHorario(r) && r.ok) {
      recargar();
      return true;
    }
    toast.error(esFueraDeHorario(r) ? mensajeDeError(r.motivo) : (r.mensaje ?? MENSAJE_GENERICO));
    if (!esFueraDeHorario(r) && r.recargar) recargar();
    return false;
  }

  function cerrarFormulario(exito: boolean) {
    setFormulario(null);
    if (exito) {
      recargar();
      toast.success(formulario?.cita ? 'Cita reprogramada' : 'Cita agendada');
    }
  }

  const abrirAlta = (fechaInicial?: string) => setFormulario(fechaInicial ? { fecha: fechaInicial } : {});

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {puedeFiltrar ? (
          <div className="w-full sm:w-64">
            <FiltroMedico medicos={medicos} valor={medicoId} onCambio={setMedicoId} />
          </div>
        ) : (
          <span />
        )}
        {esMovil ? null : <Button onClick={() => abrirAlta()}>Nueva cita</Button>}
      </div>

      {esMovil ? (
        <ListaDelDia
          citas={citas}
          medicos={medicos}
          tipos={tipos}
          zona={zona}
          fecha={fecha}
          onFecha={setFecha}
          onSeleccionar={(c) => setDetalleId(c.id)}
          onNueva={() => abrirAlta(fecha)}
        />
      ) : (
        <Calendario
          eventos={eventos}
          zona={zona}
          onRango={alCambiarRango}
          onSeleccionar={setDetalleId}
          onHueco={(inicio) => abrirAlta(fechaLocal(inicio, zona))}
          onReprogramar={reprogramarArrastrada}
        />
      )}

      <Dialog open={Boolean(detalle)} onOpenChange={(abierto) => !abierto && setDetalleId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cita</DialogTitle>
            <DialogDescription>Detalle y cambio de estado</DialogDescription>
          </DialogHeader>
          {detalle ? (
            <DetalleCita
              cita={detalle}
              medico={medicos.find((m) => m.usuarioId === detalle.medicoId)?.nombre ?? ''}
              tipo={tipos.find((t) => t.id === detalle.tipoCitaId)?.nombre ?? ''}
              zona={zona}
              onCambio={() => {
                setDetalleId(null);
                recargar();
              }}
              onReprogramar={() => {
                setDetalleId(null);
                setFormulario({ cita: detalle });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={formulario !== null} onOpenChange={(abierto) => !abierto && setFormulario(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{formulario?.cita ? 'Reprogramar cita' : 'Nueva cita'}</DialogTitle>
            <DialogDescription>Elige médico, tipo de cita, fecha y horario.</DialogDescription>
          </DialogHeader>
          {formulario ? (
            <FormularioCita
              medicos={medicos}
              tipos={tipos}
              zona={zona}
              {...(formulario.cita ? { cita: formulario.cita } : {})}
              {...(medicoId ? { medicoIdInicial: medicoId } : {})}
              {...(formulario.fecha ? { fechaInicial: formulario.fecha } : {})}
              onListo={() => cerrarFormulario(true)}
              onCancelar={() => cerrarFormulario(false)}
              onConflicto={recargar}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
