import { redirect } from 'next/navigation';
import { datosOFalla } from '@/features/comun/errores';
import { listarMiembros } from '@/features/equipo/api';
import { FormularioAltaMiembro } from '@/features/equipo/components/FormularioAltaMiembro';
import { TablaMiembros } from '@/features/equipo/components/TablaMiembros';
import { obtenerContexto } from '@/lib/sesion/contexto';

export default async function EquipoPage() {
  const { claims } = await obtenerContexto();
  if (!claims.admin) redirect('/sin-acceso');
  const miembros = datosOFalla(await listarMiembros(), 'el equipo');
  return (
    <div className="grid gap-8">
      <h1 className="text-2xl font-semibold">Equipo</h1>
      <TablaMiembros miembros={miembros} />
      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Agregar persona</h2>
        <FormularioAltaMiembro />
      </section>
    </div>
  );
}
