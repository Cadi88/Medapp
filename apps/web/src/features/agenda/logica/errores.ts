const GENERICO = 'Ocurrió un error. Intenta de nuevo.';

/** Textos de la spec §4.5. Los códigos internos o desconocidos dan un aviso genérico: nunca se muestran detalles. */
const MENSAJES: Record<string, string> = {
  HORARIO_OCUPADO: 'Ese horario ya se ocupó, elige otro',
  HORARIO_BLOQUEADO: 'El médico tiene ese horario bloqueado',
  FUERA_DE_HORARIO: 'El horario queda fuera de la jornada del médico',
  CONFLICTO_VERSION: 'Alguien modificó esta cita',
  CONFLICTO: 'Ese cambio de estado ya no es posible para esta cita',
  VALIDACION: 'Revisa los datos del formulario',
  PROHIBIDO: 'No tienes acceso',
  NO_ENCONTRADO: 'La cita ya no existe',
};

export const MENSAJE_GENERICO = GENERICO;

export function mensajeDeError(code: string): string {
  return MENSAJES[code] ?? GENERICO;
}

/** Errores tras los que la pantalla debe volver a leer los datos (huecos o citas desactualizados). */
export function pideRecargar(code: string): boolean {
  return code === 'HORARIO_OCUPADO' || code === 'CONFLICTO_VERSION' || code === 'CONFLICTO' || code === 'NO_ENCONTRADO';
}
