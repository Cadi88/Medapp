import { redirect } from 'next/navigation';
import { SeccionRecordatorios } from '@/features/consultorio/components/SeccionRecordatorios';
import { FormularioPersonalizacion } from '@/features/consultorio/components/FormularioPersonalizacion';
import { SeccionLogo } from '@/features/consultorio/components/SeccionLogo';
import { datosOFalla } from '@/features/comun/errores';
import { obtenerConfig } from '@/features/recordatorios/api';
import { obtenerContexto } from '@/lib/sesion/contexto';

export default async function ConsultorioPage() {
  const { claims, consultorio } = await obtenerContexto();
  if (!claims.admin) redirect('/sin-acceso');
  const nombre = consultorio.nombreComercial ?? consultorio.nombre;
  const config = datosOFalla(await obtenerConfig(), 'los recordatorios');
  return (
    <div className="grid gap-8">
      <h1 className="text-2xl font-semibold">Mi consultorio</h1>
      <FormularioPersonalizacion consultorio={consultorio} />
      <SeccionLogo nombre={nombre} consultorioId={consultorio.id} logoVersion={consultorio.logoVersion} />
      <SeccionRecordatorios config={config} consultorio={nombre} telefono={consultorio.telefono} />
    </div>
  );
}
