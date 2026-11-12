export interface Medico {
  nombre: string;
  activo: boolean;
}

export interface EventoMedico {
  tipo: 'vinculado' | 'actualizado' | 'desvinculado';
  nombre?: string;
  rol?: 'medico' | 'recepcion';
}

/**
 * Copia local de médicos a partir de los eventos de identidad. Nunca se borra: las citas históricas
 * siguen apuntando al médico. `medico` activa/renombra; `recepcion` solo desactiva a quien ya existía.
 */
export function aplicarEventoMedico(actual: Medico | null, e: EventoMedico): Medico | null {
  if (e.tipo === 'desvinculado') return actual ? { ...actual, activo: false } : null;
  const nombre = e.nombre ?? actual?.nombre ?? '';
  if (e.rol === 'medico') return { nombre, activo: true };
  return actual ? { nombre, activo: false } : null;
}
