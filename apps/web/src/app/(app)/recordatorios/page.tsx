import { redirect } from 'next/navigation';
import { datosOFalla } from '@/features/comun/errores';
import { listarRecordatorios } from '@/features/recordatorios/api';
import { PanelRecordatorios } from '@/features/recordatorios/components/PanelRecordatorios';
import { rangoPorOmision } from '@/features/recordatorios/logica/presentacion';
import { obtenerContexto } from '@/lib/sesion/contexto';

/** Administración y recepción; un médico sin admin no ve los datos de contacto de otros pacientes. */
export default async function RecordatoriosPage() {
  const { claims, consultorio } = await obtenerContexto();
  if (!claims.admin && claims.rol !== 'recepcion') redirect('/sin-acceso');
  const { desde, hasta } = rangoPorOmision(new Date(), consultorio.zonaHoraria);
  const datos = datosOFalla(await listarRecordatorios(desde, hasta), 'los recordatorios');
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Recordatorios</h1>
      <PanelRecordatorios datos={datos} desde={desde} hasta={hasta} zona={consultorio.zonaHoraria} />
    </div>
  );
}
