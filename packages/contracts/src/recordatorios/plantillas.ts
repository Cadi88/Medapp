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

export const CAMPOS_PLANTILLA: readonly (keyof DatosPlantilla)[] = ['paciente', 'fecha', 'hora', 'medico', 'consultorio', 'telefono_consultorio'];

export const LIMITES_PLANTILLA: Record<keyof Plantillas, number> = { correoAsunto: 120, correoCuerpo: 1000, whatsapp: 700 };

/**
 * Sustituye `{campo}` por su valor en una sola pasada (un valor con llaves no se vuelve a sustituir). Los campos
 * desconocidos o ausentes se dejan tal cual. `escapar` (p. ej. HTML) se aplica al texto de la plantilla y a los valores.
 */
export function rellenarPlantilla(plantilla: string, datos: DatosPlantilla, escapar?: (texto: string) => string): string {
  const base = escapar ? escapar(plantilla) : plantilla;
  return base.replace(/\{([a-z_]+)\}/g, (completo, campo: string) => {
    if (!Object.hasOwn(datos, campo)) return completo;
    const valor = datos[campo as keyof DatosPlantilla];
    if (typeof valor !== 'string') return completo;
    return escapar ? escapar(valor) : valor;
  });
}

/** Mensaje de error de una plantilla, o `undefined` si es válida. */
export function errorDePlantilla(campo: keyof Plantillas, texto: string): string | undefined {
  if (texto.trim().length === 0) return 'La plantilla no puede estar vacía';
  return texto.length > LIMITES_PLANTILLA[campo] ? `Máximo ${LIMITES_PLANTILLA[campo]} caracteres` : undefined;
}

export type ResultadoValidacion = { ok: true } | { ok: false; campo: keyof Plantillas; error: string };

export function validarPlantillas(p: Plantillas): ResultadoValidacion {
  for (const campo of Object.keys(LIMITES_PLANTILLA) as (keyof Plantillas)[]) {
    const error = errorDePlantilla(campo, p[campo]);
    if (error) return { ok: false, campo, error };
  }
  return { ok: true };
}
