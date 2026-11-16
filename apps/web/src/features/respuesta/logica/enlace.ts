import { respuestaPacienteSchema, type RespuestaPacienteValor } from '@consultorio/contracts';

export const TEXTO_INVALIDO = 'Este enlace ya no es válido';
export const TEXTO_RESPONDIDA = 'Esta cita ya fue respondida. Si necesitas otro cambio, llama al consultorio';
export const TEXTO_GRACIAS = 'Gracias, recibimos tu respuesta';

/** Un token es base64url (32 bytes); cualquier otra cosa es un enlace inválido y nunca llega al servicio. */
const FORMA_DE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
export const tieneFormaDeToken = (token: string): boolean => FORMA_DE_TOKEN.test(token);

export const OPCIONES_RESPUESTA: { valor: RespuestaPacienteValor; etiqueta: string }[] = [
  { valor: 'confirma', etiqueta: 'Confirmar mi cita' },
  { valor: 'cancela', etiqueta: 'Cancelar mi cita' },
  { valor: 'pide_cambio', etiqueta: 'Pedir cambio de horario' },
];

/** `?accion=` del correo: solo preselecciona una opción; un valor desconocido no selecciona nada. */
export function accionInicial(accion: string | string[] | undefined): RespuestaPacienteValor | undefined {
  const primera = Array.isArray(accion) ? accion[0] : accion;
  const r = respuestaPacienteSchema.safeParse(primera);
  return r.success ? r.data : undefined;
}
