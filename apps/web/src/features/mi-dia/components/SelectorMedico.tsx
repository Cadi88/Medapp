'use client';

import type { MedicoAgenda } from '@consultorio/contracts';
import { useRouter } from 'next/navigation';
import { CampoSelect } from '@/features/agenda/components/CampoSelect';

interface Props {
  medicos: MedicoAgenda[];
  /** Médico elegido; `''` si todavía no se elige ninguno. */
  valor: string;
}

/** Administración y recepción eligen de qué médico ver el día; el elegido viaja en la dirección (`?medico=`). */
export function SelectorMedico({ medicos, valor }: Props) {
  const router = useRouter();
  return (
    <CampoSelect nombre="medico" etiqueta="Médico" value={valor} onChange={(e) => router.push(`/mi-dia?medico=${encodeURIComponent(e.target.value)}`)}>
      {valor === '' ? <option value="">Elige un médico</option> : null}
      {medicos.map((m) => (
        <option key={m.usuarioId} value={m.usuarioId}>
          {m.nombre}
        </option>
      ))}
    </CampoSelect>
  );
}
