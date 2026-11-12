'use client';

import type { MedicoAgenda } from '@consultorio/contracts';
import { CampoSelect } from './CampoSelect';

interface Props {
  medicos: MedicoAgenda[];
  /** `''` = todos los médicos. */
  valor: string;
  onCambio: (medicoId: string) => void;
}

/** Solo lo ven administración y recepción; un médico ve únicamente su propia agenda. */
export function FiltroMedico({ medicos, valor, onCambio }: Props) {
  return (
    <CampoSelect nombre="filtro-medico" etiqueta="Médico" value={valor} onChange={(e) => onCambio(e.target.value)}>
      <option value="">Todos los médicos</option>
      {medicos.map((m) => (
        <option key={m.usuarioId} value={m.usuarioId}>
          {m.nombre}
        </option>
      ))}
    </CampoSelect>
  );
}
