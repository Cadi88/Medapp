import { notFound } from 'next/navigation';
import { z } from 'zod';
import { listarMedicos, listarTiposCita } from '@/features/agenda/api';
import { datosOFalla } from '@/features/comun/errores';
import { FichaMedico } from '@/features/medicos/components/FichaMedico';
import { leerHorario, listarBloqueosDesde } from '@/features/medicos/api';
import { obtenerContexto } from '@/lib/sesion/contexto';

export default async function MedicoPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { consultorio } = await obtenerContexto();
  const medico = datosOFalla(await listarMedicos(), 'los médicos').find((m) => m.usuarioId === id);
  if (!medico) notFound();
  const [horario, tipos, bloqueos] = await Promise.all([
    leerHorario(id),
    // Todos los tipos: también los desactivados, para poder reactivarlos.
    listarTiposCita(id, true),
    listarBloqueosDesde(id, new Date().toISOString()),
  ]);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{medico.nombre}</h1>
      <FichaMedico
        medicoId={id}
        bloques={datosOFalla(horario, 'el horario')}
        tipos={datosOFalla(tipos, 'los tipos de cita')}
        bloqueos={datosOFalla(bloqueos, 'los bloqueos')}
        zona={consultorio.zonaHoraria}
      />
    </div>
  );
}
