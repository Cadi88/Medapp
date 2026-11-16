/**
 * Plantillas de los recordatorios. Copia de la lógica de `svc-notificaciones` (`dominio/plantillas.ts`) para la vista
 * previa y la validación inmediata del formulario: la autoridad es el servidor, que vuelve a validar al guardar.
 */
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

/** Los campos que una plantilla puede usar, tal como se escriben. */
export const CAMPOS_PLANTILLA: readonly (keyof DatosPlantilla)[] = ['paciente', 'fecha', 'hora', 'medico', 'consultorio', 'telefono_consultorio'];

export const DATOS_DE_EJEMPLO: DatosPlantilla = {
  paciente: 'María López',
  fecha: 'jueves 19 de noviembre',
  hora: '10:00',
  medico: 'Dra. Ruiz',
  consultorio: 'Mi consultorio',
  telefono_consultorio: '55 1234 5678',
};

/**
 * Sustituye `{campo}` por su valor en una sola pasada (un valor con llaves no se vuelve a sustituir). Los campos
 * desconocidos se dejan tal cual. Es texto plano: React escapa lo que se muestra.
 */
export function rellenar(plantilla: string, datos: DatosPlantilla): string {
  return plantilla.replace(/\{([a-z_]+)\}/g, (completo, campo: string) => {
    if (!Object.hasOwn(datos, campo)) return completo;
    const valor = datos[campo as keyof DatosPlantilla];
    return typeof valor === 'string' ? valor : completo;
  });
}

export type ResultadoValidacion = { ok: true } | { ok: false; campo: keyof Plantillas; error: string };

export function errorDePlantilla(campo: keyof Plantillas, texto: string): string | undefined {
  if (texto.trim().length === 0) return 'La plantilla no puede estar vacía';
  return texto.length > LIMITES_PLANTILLA[campo] ? `Máximo ${LIMITES_PLANTILLA[campo]} caracteres` : undefined;
}

export function validarPlantillas(p: Plantillas): ResultadoValidacion {
  for (const campo of Object.keys(LIMITES_PLANTILLA) as (keyof Plantillas)[]) {
    const error = errorDePlantilla(campo, p[campo]);
    if (error) return { ok: false, campo, error };
  }
  return { ok: true };
}

export const MODOS = ['con_revision', 'sin_revision'] as const;
export type Modo = (typeof MODOS)[number];
export const ETIQUETA_MODO: Record<Modo, string> = {
  con_revision: 'Con revisión: solo se envía lo aprobado',
  sin_revision: 'Sin revisión: todo se envía solo',
};

export const MENSAJE_MODO = 'Elige un modo';
export const MENSAJE_HORA = 'Escribe una hora válida (HH:MM)';
export const esHoraValida = (hora: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
export const esModoValido = (modo: string): modo is Modo => (MODOS as readonly string[]).includes(modo);
