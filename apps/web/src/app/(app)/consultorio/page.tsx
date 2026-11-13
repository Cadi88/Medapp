import { redirect } from 'next/navigation';
import { FormularioPersonalizacion } from '@/features/consultorio/components/FormularioPersonalizacion';
import { SeccionLogo } from '@/features/consultorio/components/SeccionLogo';
import { obtenerContexto } from '@/lib/sesion/contexto';

export default async function ConsultorioPage() {
  const { claims, consultorio } = await obtenerContexto();
  if (!claims.admin) redirect('/sin-acceso');
  return (
    <div className="grid gap-8">
      <h1 className="text-2xl font-semibold">Mi consultorio</h1>
      <FormularioPersonalizacion consultorio={consultorio} />
      <SeccionLogo nombre={consultorio.nombreComercial ?? consultorio.nombre} logoVersion={consultorio.logoVersion} />
    </div>
  );
}
