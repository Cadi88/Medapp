import { Button } from '@/components/ui/button';
import { CampoSelect } from '@/features/agenda/components/CampoSelect';
import { Campo } from '@/features/sesion/components/campo';
import { ACCIONES_CONOCIDAS, etiquetaAccion } from '../logica/acciones';

/** Filtros por GET: quedan en la URL y la página se vuelve a generar en el servidor. */
export function FiltrosBitacora({ desde, hasta, accion }: { desde: string; hasta: string; accion: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtros de la bitácora">
      <Campo nombre="desde" etiqueta="Desde" type="date" defaultValue={desde} />
      <Campo nombre="hasta" etiqueta="Hasta" type="date" defaultValue={hasta} />
      <CampoSelect nombre="accion" etiqueta="Acción" defaultValue={accion}>
        <option value="">Todas</option>
        {ACCIONES_CONOCIDAS.map((a) => (
          <option key={a} value={a}>
            {etiquetaAccion(a)}
          </option>
        ))}
      </CampoSelect>
      <Button type="submit">Filtrar</Button>
    </form>
  );
}
