import { redirect } from 'next/navigation';
import { listarEventos } from '@/features/bitacora/api';
import { FiltrosBitacora } from '@/features/bitacora/components/FiltrosBitacora';
import { TablaBitacora } from '@/features/bitacora/components/TablaBitacora';
import { consultaDesdeParametros } from '@/features/bitacora/logica/filtros';
import { datosOFalla } from '@/features/comun/errores';
import { listarMiembros } from '@/features/equipo/api';
import { obtenerContexto } from '@/lib/sesion/contexto';

const primero = (p: string | string[] | undefined) => (Array.isArray(p) ? (p[0] ?? '') : (p ?? ''));

export default async function BitacoraPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const { claims, consultorio } = await obtenerContexto();
  if (!claims.admin) redirect('/sin-acceso');
  const params = await searchParams;
  const consulta = consultaDesdeParametros(params, consultorio.zonaHoraria);
  const [pagina, miembros] = await Promise.all([listarEventos(consulta), listarMiembros()]);
  const { eventos, siguiente } = datosOFalla(pagina, 'la bitácora');
  const nombres = Object.fromEntries(datosOFalla(miembros, 'el equipo').map((m) => [m.usuarioId, m.nombre]));
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Bitácora</h1>
      <FiltrosBitacora desde={primero(params.desde)} hasta={primero(params.hasta)} accion={consulta.accion ?? ''} />
      {/* `key`: al cambiar los filtros la tabla vuelve a empezar con la primera página. */}
      <TablaBitacora
        key={JSON.stringify(consulta)}
        eventos={eventos}
        siguiente={siguiente}
        nombres={nombres}
        zona={consultorio.zonaHoraria}
        filtros={consulta}
      />
    </div>
  );
}
