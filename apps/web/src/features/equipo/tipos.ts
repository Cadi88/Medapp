import type { EstadoFormulario } from '@/features/sesion/tipos';

/** `passwordTemporal`: se devuelve una sola vez para que el admin la comparta; no se vuelve a mostrar. */
export interface EstadoPasswordTemporal extends EstadoFormulario {
  passwordTemporal?: string;
  /** Alta de alguien que ya tenía cuenta (de este u otro consultorio): entra con su contraseña actual. */
  cuentaExistente?: true;
}
