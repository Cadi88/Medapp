const ETIQUETAS = {
  'tenant.creado': 'Consultorio creado',
  'usuario.vinculado': 'Persona agregada al equipo',
  'usuario.desvinculado': 'Persona quitada del equipo',
  'miembro.actualizado': 'Miembro actualizado',
  'medico.actualizado': 'Perfil médico actualizado',
  'cita.creada': 'Cita creada',
  'cita.reprogramada': 'Cita reprogramada',
  'cita.cancelada': 'Cita cancelada',
  'cita.estado_cambiado': 'Estado de cita cambiado',
} as const satisfies Record<string, string>;

export const ACCIONES_CONOCIDAS = Object.keys(ETIQUETAS) as (keyof typeof ETIQUETAS)[];

/** Texto legible de la acción; si no se conoce (acción de una versión nueva) se muestra el código tal cual. */
export function etiquetaAccion(accion: string): string {
  return (ETIQUETAS as Record<string, string>)[accion] ?? accion;
}
