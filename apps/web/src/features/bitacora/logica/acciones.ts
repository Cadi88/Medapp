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
  'consultorio.actualizado': 'Consultorio actualizado',
} as const satisfies Record<string, string>;

export const ACCIONES_CONOCIDAS = Object.keys(ETIQUETAS) as (keyof typeof ETIQUETAS)[];

/** Texto legible de la acción; si no se conoce (acción de una versión nueva) se muestra el código tal cual. */
export function etiquetaAccion(accion: string): string {
  return (ETIQUETAS as Record<string, string>)[accion] ?? accion;
}

const CAMPOS_CONSULTORIO: Record<string, string> = {
  logo: 'Logo',
  colorPrimario: 'Color',
  nombreComercial: 'Nombre comercial',
  direccion: 'Dirección',
  telefono: 'Teléfono',
};

/**
 * Qué cambió, en español, para las acciones cuyo detalle lo dice (hoy solo consultorio.actualizado).
 * `detalle` es el `data` del evento tal como lo guarda la auditoría; un campo que esta versión no conoce se omite.
 */
export function detalleDeAccion(accion: string, detalle: unknown): string | undefined {
  if (accion !== 'consultorio.actualizado') return undefined;
  const campos = (detalle as { campos?: unknown } | null)?.campos;
  if (!Array.isArray(campos)) return undefined;
  const textos = campos.flatMap((c) => (typeof c === 'string' && c in CAMPOS_CONSULTORIO ? [CAMPOS_CONSULTORIO[c] as string] : []));
  return textos.length > 0 ? textos.join(', ') : undefined;
}
