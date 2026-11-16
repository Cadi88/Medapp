import { LIMITES_PLANTILLA, rellenarPlantilla, validarPlantillas, type DatosPlantilla, type Plantillas } from '@consultorio/contracts';

// Los campos, los límites y la validación son los mismos que usa la pantalla de configuración: viven en contracts.
export { LIMITES_PLANTILLA, validarPlantillas };
export type { DatosPlantilla, Plantillas, ResultadoValidacion } from '@consultorio/contracts';

export const PLANTILLAS_POR_OMISION: Plantillas = {
  correoAsunto: 'Recordatorio de tu cita en {consultorio}',
  correoCuerpo:
    'Hola {paciente}, te recordamos tu cita con {medico} el {fecha} a las {hora} en {consultorio}. ' +
    'Si necesitas hablar con nosotros, llama al {telefono_consultorio}.',
  whatsapp:
    'Hola {paciente}, te recordamos tu cita con {medico} el {fecha} a las {hora} en {consultorio}. ' +
    '¿Nos confirmas tu asistencia? Cualquier duda, llama al {telefono_consultorio}.',
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escaparHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Con `html: true` escapa el texto de la plantilla y los valores; si no, texto plano. */
export function rellenar(plantilla: string, datos: DatosPlantilla, o: { html: boolean }): string {
  return rellenarPlantilla(plantilla, datos, o.html ? escaparHtml : undefined);
}
