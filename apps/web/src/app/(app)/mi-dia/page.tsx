import { listarCitas, listarMedicos, listarTiposCita } from '@/features/agenda/api';
import { datosOFalla } from '@/features/comun/errores';
import { MiDia } from '@/features/mi-dia/components/MiDia';
import { SelectorMedico } from '@/features/mi-dia/components/SelectorMedico';
import { rangoDeMiDia } from '@/features/mi-dia/logica/mi-dia';
import { obtenerContexto } from '@/lib/sesion/contexto';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Un médico ve su propio día (su `medicoId` es su id de usuario; `?medico=` no cuenta). Administración y recepción eligen
 * de qué médico; un administrador que también es médico empieza con el suyo.
 */
export default async function MiDiaPage({ searchParams }: Props) {
  const { claims, consultorio } = await obtenerContexto();
  const puedeElegir = claims.admin || claims.rol === 'recepcion';
  const medicos = puedeElegir ? datosOFalla(await listarMedicos(), 'los médicos') : [];

  const pedido = (await searchParams).medico;
  const elegido = typeof pedido === 'string' ? pedido : undefined;
  const porOmision = claims.rol === 'medico' ? claims.sub : '';
  const medicoId = puedeElegir ? (medicos.some((m) => m.usuarioId === elegido) ? (elegido ?? '') : porOmision) : claims.sub;

  const { hoy, desde, hasta } = rangoDeMiDia(new Date(), consultorio.zonaHoraria);
  const citas = medicoId === '' ? [] : datosOFalla(await listarCitas(desde, hasta, medicoId), 'Mi día');
  const tipos = medicoId === '' ? [] : datosOFalla(await listarTiposCita(medicoId, true), 'Mi día');

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Mi día</h1>
      {puedeElegir ? <SelectorMedico medicos={medicos} valor={medicoId} /> : null}
      {medicoId === '' ? (
        <p className="text-sm text-muted-foreground">Elige un médico para ver su día</p>
      ) : (
        <MiDia citas={citas} tipos={tipos} zona={consultorio.zonaHoraria} hoy={hoy} />
      )}
    </div>
  );
}
