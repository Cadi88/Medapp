'use client';

import {
  CAMPOS_PLANTILLA,
  errorDePlantilla,
  rellenarPlantilla,
  type ConfigRecordatoriosDto,
  type DatosPlantilla,
  type Plantillas,
} from '@consultorio/contracts';
import { useActionState, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CampoSelect } from '@/features/agenda/components/CampoSelect';
import { AvisoDeError, MensajeDeCampo } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { guardarConfigRecordatorios } from '../actions';
import { DATOS_DE_EJEMPLO, ETIQUETA_MODO, MODOS } from '../logica/plantillas';

interface Props {
  config: ConfigRecordatoriosDto;
  /** Nombre que se muestra del consultorio y su teléfono: rellenan la vista previa igual que el correo real. */
  consultorio: string;
  telefono: string | null;
}

const AREA = 'min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs aria-invalid:border-destructive';

const ID_VISTA = { correoAsunto: 'vista-asunto', correoCuerpo: 'vista-cuerpo', whatsapp: 'vista-whatsapp' } as const;

interface CampoPlantillaProps {
  nombre: keyof Plantillas;
  etiqueta: string;
  valor: string;
  onCambio: (valor: string) => void;
  error: string | undefined;
  /** Texto ya rellenado con los datos de ejemplo. */
  vista: string;
  filas?: number;
}

function CampoPlantilla({ nombre, etiqueta, valor, onCambio, error, vista, filas = 4 }: CampoPlantillaProps) {
  const alCambiar = (e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => onCambio(e.target.value);
  return (
    <div className="grid gap-2">
      <Label htmlFor={nombre}>{etiqueta}</Label>
      {nombre === 'correoAsunto' ? (
        <Input id={nombre} name={nombre} value={valor} onChange={alCambiar} aria-invalid={error ? true : undefined} aria-describedby={error ? `${nombre}-error` : undefined} />
      ) : (
        <textarea
          id={nombre}
          name={nombre}
          rows={filas}
          value={valor}
          onChange={alCambiar}
          className={AREA}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${nombre}-error` : undefined}
        />
      )}
      <MensajeDeCampo id={`${nombre}-error`}>{error}</MensajeDeCampo>
      <div className="rounded-md bg-muted/50 p-3 text-sm">
        <p className="text-xs text-muted-foreground">Vista previa con datos de ejemplo</p>
        <p data-testid={ID_VISTA[nombre]} className="whitespace-pre-line">
          {vista}
        </p>
      </div>
    </div>
  );
}

/** Recordatorios al paciente: modo, hora de envío y plantillas del correo y del WhatsApp. Solo administración. */
export function SeccionRecordatorios({ config, consultorio, telefono }: Props) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(guardarConfigRecordatorios, {});
  const [plantillas, setPlantillas] = useState<Plantillas>(config.plantillas);
  const datos: DatosPlantilla = { ...DATOS_DE_EJEMPLO, consultorio, telefono_consultorio: telefono ?? DATOS_DE_EJEMPLO.telefono_consultorio };
  const cambiar = (campo: keyof Plantillas) => (valor: string) => setPlantillas((p) => ({ ...p, [campo]: valor }));
  const errorLocal = (campo: keyof Plantillas) => errorDePlantilla(campo, plantillas[campo]);
  const hayErrores = (['correoAsunto', 'correoCuerpo', 'whatsapp'] as const).some((c) => errorLocal(c) !== undefined);

  return (
    <section className="grid max-w-2xl gap-4" aria-labelledby="titulo-recordatorios">
      <h2 id="titulo-recordatorios" className="text-lg font-medium">
        Recordatorios
      </h2>
      <form action={accion} className="grid gap-4" noValidate>
        <AvisoDeError mensaje={estado.mensaje} />
        <CampoSelect nombre="modo" etiqueta="Modo" defaultValue={estado.valores?.modo ?? config.modo} error={estado.errores?.modo}>
          {MODOS.map((m) => (
            <option key={m} value={m}>
              {ETIQUETA_MODO[m]}
            </option>
          ))}
        </CampoSelect>
        <div className="grid max-w-40 gap-2">
          <Label htmlFor="horaEnvio">Hora de envío</Label>
          <Input
            id="horaEnvio"
            name="horaEnvio"
            type="time"
            defaultValue={estado.valores?.horaEnvio ?? config.horaEnvio}
            aria-invalid={estado.errores?.horaEnvio ? true : undefined}
          />
          <MensajeDeCampo id="horaEnvio-error">{estado.errores?.horaEnvio}</MensajeDeCampo>
        </div>
        <p className="text-sm text-muted-foreground">
          El recordatorio sale el día anterior a la cita, a esta hora, todos los días de la semana. Campos que puedes usar en los textos:{' '}
          {CAMPOS_PLANTILLA.map((c) => (
            <code key={c} className="mr-1 rounded bg-muted px-1">{`{${c}}`}</code>
          ))}
        </p>
        <CampoPlantilla
          nombre="correoAsunto"
          etiqueta="Asunto del correo"
          valor={plantillas.correoAsunto}
          onCambio={cambiar('correoAsunto')}
          error={errorLocal('correoAsunto') ?? estado.errores?.correoAsunto}
          vista={rellenarPlantilla(plantillas.correoAsunto, datos)}
        />
        <CampoPlantilla
          nombre="correoCuerpo"
          etiqueta="Cuerpo del correo"
          valor={plantillas.correoCuerpo}
          onCambio={cambiar('correoCuerpo')}
          error={errorLocal('correoCuerpo') ?? estado.errores?.correoCuerpo}
          vista={rellenarPlantilla(plantillas.correoCuerpo, datos)}
          filas={6}
        />
        <CampoPlantilla
          nombre="whatsapp"
          etiqueta="Mensaje de WhatsApp"
          valor={plantillas.whatsapp}
          onCambio={cambiar('whatsapp')}
          error={errorLocal('whatsapp') ?? estado.errores?.whatsapp}
          vista={rellenarPlantilla(plantillas.whatsapp, datos)}
        />
        {estado.ok ? (
          <p role="status" className="text-sm text-muted-foreground">
            Recordatorios guardados
          </p>
        ) : null}
        <Button type="submit" disabled={enviando || hayErrores} className="w-fit">
          {enviando ? 'Guardando…' : 'Guardar recordatorios'}
        </Button>
      </form>
    </section>
  );
}
