import type { ResultadoRespuesta } from '@consultorio/contracts';

/** Lo que devuelve "Enviar respuesta": el estado final del enlace o un aviso para reintentar. */
export interface EstadoRespuesta {
  estado?: ResultadoRespuesta['estado'];
  mensaje?: string;
}
