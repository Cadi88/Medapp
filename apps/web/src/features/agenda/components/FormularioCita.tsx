'use client';

import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AvisoDeError, Campo, MensajeDeCampo } from '@/features/sesion/components/campo';
import { cargarHuecos, crearCita, reprogramarCita } from '../actions';
import { fechaLocal, formatearHora, instanteLocal } from '../logica/formato';
import { esFueraDeHorario, type ResultadoCita } from '../tipos';
import { CampoSelect } from './CampoSelect';

interface Props {
  medicos: MedicoAgenda[];
  tipos: TipoCita[];
  zona: string;
  /** Con `cita` el formulario reprograma esa cita; sin ella, agenda una nueva. */
  cita?: Cita;
  medicoIdInicial?: string;
  /** `YYYY-MM-DD` en la zona del consultorio. */
  fechaInicial?: string;
  /** Instante del hueco vacío que se tocó en el calendario: precarga la fecha y la hora exactas ("Otra hora"). */
  inicioInicial?: string;
  onListo: () => void;
  onCancelar: () => void;
  /** Lo que se ve quedó desactualizado (horario ocupado, versión obsoleta): quien lo muestra debe recargar. */
  onConflicto?: () => void;
}

const FALTAN_DATOS = 'Elige tipo de cita, fecha y horario';

/**
 * Médico → tipo → fecha → hueco sugerido u "Otra hora" → contacto → notas. Reutilizado para reprogramar (sin médico ni
 * contacto). "Otra hora" permite elegir un inicio fuera de los huecos sugeridos (p. ej., fuera de la jornada: el API
 * responde FUERA_DE_HORARIO y se ofrece "Agendar de todos modos").
 */
export function FormularioCita({ medicos, tipos, zona, cita, medicoIdInicial, fechaInicial, inicioInicial, onListo, onCancelar, onConflicto }: Props) {
  const [medicoId, setMedicoId] = useState(cita?.medicoId ?? medicoIdInicial ?? (medicos.length === 1 ? (medicos[0]?.usuarioId ?? '') : ''));
  const [tipoCitaId, setTipoCitaId] = useState(cita?.tipoCitaId ?? '');
  const [fecha, setFecha] = useState(() => {
    if (cita) return fechaLocal(cita.inicio, zona);
    if (inicioInicial) return fechaLocal(inicioInicial, zona);
    return fechaInicial ?? fechaLocal(new Date().toISOString(), zona);
  });
  const [carga, setCarga] = useState<{ clave: string; huecos: string[] } | null>(null);
  const [hueco, setHueco] = useState('');
  /** `HH:mm` local escrita en "Otra hora"; si hay una, manda sobre el hueco sugerido. */
  const [horaLibre, setHoraLibre] = useState(() => (inicioInicial && !cita ? formatearHora(inicioInicial, zona) : ''));
  const [recarga, setRecarga] = useState(0);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [notas, setNotas] = useState('');
  const [estado, setEstado] = useState<ResultadoCita>({});
  const [fueraDeHorario, setFueraDeHorario] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const tiposDelMedico = tipos.filter((t) => t.medicoId === medicoId && (t.activo || t.id === cita?.tipoCitaId));

  // Los huecos valen solo para la combinación que se pidió; si cambia algo, `huecos` vuelve a ser null hasta que llegue la respuesta.
  const clave = `${medicoId}|${tipoCitaId}|${fecha}|${recarga}`;
  const huecos = medicoId && tipoCitaId && fecha && carga?.clave === clave ? carga.huecos : null;
  const inicio = horaLibre ? instanteLocal(fecha, horaLibre, zona) : hueco;

  useEffect(() => {
    if (!medicoId || !tipoCitaId || !fecha) return;
    let vigente = true;
    void cargarHuecos(medicoId, fecha, tipoCitaId).then((r) => {
      if (!vigente) return;
      setCarga({ clave, huecos: r.ok ? r.huecos : [] });
      if (!r.ok) setEstado({ mensaje: r.mensaje });
    });
    return () => {
      vigente = false;
    };
  }, [medicoId, tipoCitaId, fecha, clave]);

  /** Cambiar médico, tipo o fecha invalida el hueco sugerido elegido y el aviso de "fuera de horario". */
  function cambiar(accion: () => void) {
    accion();
    setHueco('');
    setFueraDeHorario(false);
    setEstado({});
  }

  async function enviar(forzar: boolean) {
    if (!medicoId || !tipoCitaId || !inicio) {
      setEstado({ mensaje: FALTAN_DATOS });
      return;
    }
    setEnviando(true);
    try {
      const r = cita
        ? await reprogramarCita({ citaId: cita.id, version: cita.version, inicio, tipoCitaId, fueraDeHorario: forzar })
        : await crearCita({ medicoId, tipoCitaId, inicio, nombre, telefono, email, notas, fueraDeHorario: forzar });
      if (esFueraDeHorario(r)) {
        setFueraDeHorario(true);
        setEstado({});
      } else if (r.ok) {
        onListo();
      } else {
        setFueraDeHorario(false);
        setEstado(r);
        if (r.recargar) {
          setHueco('');
          setHoraLibre('');
          setRecarga((n) => n + 1);
          onConflicto?.();
        }
      }
    } finally {
      setEnviando(false);
    }
  }

  function alEnviar(e: FormEvent) {
    e.preventDefault();
    void enviar(false);
  }

  const accion = cita ? 'Reprogramar' : 'Agendar';

  return (
    <form onSubmit={alEnviar} className="grid gap-4" noValidate>
      <AvisoDeError mensaje={estado.mensaje} />
      <CampoSelect
        nombre="medico"
        etiqueta="Médico"
        value={medicoId}
        disabled={Boolean(cita)}
        onChange={(e) => cambiar(() => {
          setMedicoId(e.target.value);
          setTipoCitaId('');
        })}
      >
        <option value="">Elige un médico</option>
        {medicos.map((m) => (
          <option key={m.usuarioId} value={m.usuarioId}>
            {m.nombre}
          </option>
        ))}
      </CampoSelect>
      <CampoSelect
        nombre="tipo"
        etiqueta="Tipo de cita"
        value={tipoCitaId}
        disabled={!medicoId}
        onChange={(e) => cambiar(() => setTipoCitaId(e.target.value))}
      >
        <option value="">Elige un tipo</option>
        {tiposDelMedico.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre} ({t.duracionMin} min)
          </option>
        ))}
      </CampoSelect>
      <Campo nombre="fecha" etiqueta="Fecha" type="date" value={fecha} onChange={(e) => cambiar(() => setFecha(e.target.value))} />

      <fieldset className="grid gap-2" aria-describedby="huecos-ayuda">
        <legend className="text-sm font-medium">Horario</legend>
        {huecos === null ? (
          <p id="huecos-ayuda" className="text-sm text-muted-foreground">
            {medicoId && tipoCitaId && fecha ? 'Buscando horarios…' : 'Elige médico, tipo de cita y fecha para ver los horarios'}
          </p>
        ) : huecos.length === 0 ? (
          <p id="huecos-ayuda" className="text-sm text-muted-foreground">
            No hay horarios disponibles ese día
          </p>
        ) : (
          <div id="huecos-ayuda" className="flex flex-wrap gap-2">
            {huecos.map((h) => (
              <label
                key={h}
                className="cursor-pointer rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-2"
              >
                <input
                  type="radio"
                  name="hueco"
                  value={h}
                  checked={!horaLibre && hueco === h}
                  onChange={() => {
                    setHueco(h);
                    setHoraLibre('');
                    setFueraDeHorario(false);
                  }}
                  className="sr-only"
                />
                {formatearHora(h, zona)}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="grid gap-1">
        <Campo
          nombre="horaLibre"
          etiqueta="Otra hora"
          type="time"
          step={300}
          value={horaLibre}
          aria-describedby="hora-libre-ayuda"
          onChange={(e) => {
            setHoraLibre(e.target.value);
            setFueraDeHorario(false);
          }}
        />
        <p id="hora-libre-ayuda" className="text-xs text-muted-foreground">
          Para una hora que no aparece arriba (por ejemplo, fuera de la jornada del médico).
        </p>
      </div>

      {cita ? null : (
        <>
          <Campo nombre="nombre" etiqueta="Nombre del paciente" value={nombre} onChange={(e) => setNombre(e.target.value)} error={estado.errores?.nombre} maxLength={120} />
          <Campo nombre="telefono" etiqueta="Teléfono" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} error={estado.errores?.telefono} />
          <Campo nombre="email" etiqueta="Correo (opcional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={estado.errores?.email} />
          <div className="grid gap-2">
            <Label htmlFor="notas">Notas (opcional)</Label>
            <textarea
              id="notas"
              name="notas"
              rows={3}
              maxLength={1000}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              aria-invalid={estado.errores?.notas ? true : undefined}
              aria-describedby={estado.errores?.notas ? 'notas-error' : undefined}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
            />
            <MensajeDeCampo id="notas-error">{estado.errores?.notas}</MensajeDeCampo>
          </div>
        </>
      )}

      {fueraDeHorario ? (
        <div role="alert" className="grid gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>El horario queda fuera de la jornada del médico.</p>
          <Button type="button" variant="outline" disabled={enviando} onClick={() => void enviar(true)}>
            {accion} de todos modos
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {accion}
        </Button>
      </div>
    </form>
  );
}
