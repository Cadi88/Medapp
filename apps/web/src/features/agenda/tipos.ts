import type { Cita } from '@consultorio/contracts';
import type { EstadoFormulario } from '@/features/sesion/tipos';

/** Resultado de crear, reprogramar o cambiar el estado; `recargar`: lo que se ve ya no está al día. */
export interface ResultadoCita extends EstadoFormulario {
  recargar?: true;
}

/** `FUERA_DE_HORARIO`: la interfaz ofrece "Agendar de todos modos" y reenvía con `fueraDeHorario: true`. */
export interface FueraDeHorario {
  ok: false;
  motivo: 'FUERA_DE_HORARIO';
}

export type ResultadoAccion = ResultadoCita | FueraDeHorario;

export type LecturaCitas = { ok: true; citas: Cita[] } | { ok: false; mensaje: string };
export type LecturaHuecos = { ok: true; huecos: string[] } | { ok: false; mensaje: string };

export const esFueraDeHorario = (r: ResultadoAccion): r is FueraDeHorario => 'motivo' in r;
