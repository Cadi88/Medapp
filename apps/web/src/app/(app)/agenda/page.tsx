import { redirect } from 'next/navigation';
import { listarMedicos, listarTiposCita } from '@/features/agenda/api';
import { AgendaCliente } from '@/features/agenda/components/AgendaCliente';
import { destinoPorError } from '@/lib/sesion/desvios';
import { obtenerContexto } from '@/lib/sesion/contexto';
import type { Resultado } from '@/lib/api/resultado';

/** Datos o desvío (sesión vencida, sin acceso…); cualquier otro error va a la frontera de error con reintento. */
function datosOFalla<T>(r: Resultado<T>): T {
  if (r.ok) return r.datos;
  const destino = destinoPorError(r.error, r.status);
  if (destino) redirect(destino);
  throw new Error(`No se pudo cargar la agenda (${r.status})`);
}

export default async function AgendaPage() {
  const { claims, consultorio } = await obtenerContexto();
  const medicos = datosOFalla(await listarMedicos());
  // Todos los tipos (también inactivos): las citas viejas pueden usar uno ya desactivado.
  const tipos = (await Promise.all(medicos.map(async (m) => datosOFalla(await listarTiposCita(m.usuarioId, true))))).flat();
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Agenda</h1>
      <AgendaCliente medicos={medicos} tipos={tipos} zona={consultorio.zonaHoraria} puedeFiltrar={claims.admin || claims.rol === 'recepcion'} />
    </>
  );
}
