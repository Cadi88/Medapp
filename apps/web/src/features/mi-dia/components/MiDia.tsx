import type { Cita, TipoCita } from '@consultorio/contracts';
import { Badge } from '@/components/ui/badge';
import { ETIQUETA_ESTADO, ETIQUETA_PIDE_CAMBIO } from '@/features/agenda/logica/estados';
import { formatearDia, formatearHora } from '@/features/agenda/logica/formato';
import { agruparPorDia, DIAS_PROXIMOS, separarCitas } from '../logica/mi-dia';

interface Props {
  citas: Cita[];
  tipos: TipoCita[];
  zona: string;
  /** Hoy en la zona del consultorio, `YYYY-MM-DD`. */
  hoy: string;
}

function TarjetaCita({ cita, tipo, zona }: { cita: Cita; tipo: string | undefined; zona: string }) {
  return (
    <li className="flex items-start gap-3 rounded-md border p-3">
      <span className="font-mono text-lg font-semibold">{formatearHora(cita.inicio, zona)}</span>
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="truncate font-medium">{cita.contacto.nombre}</span>
        {tipo ? <span className="text-sm text-muted-foreground">{tipo}</span> : null}
        <span className="flex flex-wrap gap-1">
          <Badge variant="secondary">{ETIQUETA_ESTADO[cita.estado]}</Badge>
          {cita.pideCambio ? <Badge variant="outline">{ETIQUETA_PIDE_CAMBIO}</Badge> : null}
        </span>
      </div>
    </li>
  );
}

/** El día del médico pensado primero para el celular: hoy en orden y, abajo, lo agendado en los próximos días. */
export function MiDia({ citas, tipos, zona, hoy }: Props) {
  const nombreTipo = new Map(tipos.map((t) => [t.id, t.nombre]));
  const { hoy: deHoy, proximas } = separarCitas(citas, hoy, zona);

  return (
    <div className="grid gap-8">
      <section aria-labelledby="mi-dia-hoy" className="grid gap-3">
        <h2 id="mi-dia-hoy" className="text-lg font-semibold">
          Hoy
        </h2>
        {deHoy.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tienes citas hoy</p>
        ) : (
          <ul className="grid gap-2">
            {deHoy.map((c) => (
              <TarjetaCita key={c.id} cita={c} tipo={nombreTipo.get(c.tipoCitaId)} zona={zona} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="mi-dia-proximos" className="grid gap-4">
        <h2 id="mi-dia-proximos" className="text-lg font-semibold">
          Próximos {DIAS_PROXIMOS} días
        </h2>
        {proximas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay citas agendadas en los próximos {DIAS_PROXIMOS} días</p>
        ) : (
          agruparPorDia(proximas, zona).map((d) => (
            <div key={d.fecha} className="grid gap-2">
              <h3 className="text-sm font-medium capitalize text-muted-foreground">{formatearDia(d.fecha)}</h3>
              <ul className="grid gap-2">
                {d.citas.map((c) => (
                  <TarjetaCita key={c.id} cita={c} tipo={nombreTipo.get(c.tipoCitaId)} zona={zona} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
