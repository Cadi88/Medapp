/** Campos que una plantilla puede usar: `{paciente}`, `{fecha}`, `{hora}`, `{medico}`, `{consultorio}`, `{telefono_consultorio}`. */
export interface DatosPlantilla {
  paciente: string;
  fecha: string;
  hora: string;
  medico: string;
  consultorio: string;
  telefono_consultorio: string;
}

export interface Plantillas {
  correoAsunto: string;
  correoCuerpo: string;
  whatsapp: string;
}

export const LIMITES_PLANTILLA: Record<keyof Plantillas, number> = { correoAsunto: 120, correoCuerpo: 1000, whatsapp: 700 };

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
const escaparHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/**
 * Sustituye `{campo}` por su valor en una sola pasada (un valor con llaves no se vuelve a sustituir).
 * Con `html: true` escapa el texto de la plantilla y los valores; los campos desconocidos o ausentes se dejan tal cual.
 */
export function rellenar(plantilla: string, datos: DatosPlantilla, o: { html: boolean }): string {
  const base = o.html ? escaparHtml(plantilla) : plantilla;
  return base.replace(/\{([a-z_]+)\}/g, (completo, campo: string) => {
    if (!Object.hasOwn(datos, campo)) return completo;
    const valor = datos[campo as keyof DatosPlantilla];
    if (typeof valor !== 'string') return completo;
    return o.html ? escaparHtml(valor) : valor;
  });
}

export type ResultadoValidacion = { ok: true } | { ok: false; campo: keyof Plantillas; error: string };

export function validarPlantillas(p: Plantillas): ResultadoValidacion {
  for (const campo of Object.keys(LIMITES_PLANTILLA) as (keyof Plantillas)[]) {
    const texto = p[campo];
    if (texto.trim().length === 0) return { ok: false, campo, error: 'La plantilla no puede estar vacía' };
    if (texto.length > LIMITES_PLANTILLA[campo]) return { ok: false, campo, error: `Máximo ${LIMITES_PLANTILLA[campo]} caracteres` };
  }
  return { ok: true };
}
