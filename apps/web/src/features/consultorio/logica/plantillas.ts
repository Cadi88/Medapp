import type { DatosPlantilla } from '@consultorio/contracts';

/** Datos de ejemplo para la vista previa de las plantillas; la plantilla, sus campos y límites viven en `@consultorio/contracts`. */
export const DATOS_DE_EJEMPLO: DatosPlantilla = {
  paciente: 'María López',
  fecha: 'jueves 19 de noviembre',
  hora: '10:00',
  medico: 'Dra. Ruiz',
  consultorio: 'Mi consultorio',
  telefono_consultorio: '55 1234 5678',
};

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
