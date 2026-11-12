import { redirect } from 'next/navigation';
import { listarMedicos } from '@/features/agenda/api';
import { datosOFalla } from '@/features/comun/errores';
import { ListaMedicos } from '@/features/medicos/components/ListaMedicos';
import { obtenerContexto } from '@/lib/sesion/contexto';

export default async function MedicosPage() {
  const { claims } = await obtenerContexto();
  // Un médico sin permiso de administración solo gestiona lo suyo.
  if (!claims.admin && claims.rol === 'medico') redirect(`/medicos/${claims.sub}`);
  const medicos = datosOFalla(await listarMedicos(), 'los médicos');
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Médicos</h1>
      <ListaMedicos medicos={medicos} />
    </div>
  );
}
