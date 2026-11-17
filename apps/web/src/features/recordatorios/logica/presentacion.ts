import type { RecordatorioCita, RespuestaPacienteValor } from '@consultorio/contracts';
import { DateTime } from 'luxon';
import { sumarDias } from '@/features/agenda/logica/formato';

/** Mañana y los dos días siguientes (fechas locales del consultorio): lo que muestra la pantalla por omisión. */
export function rangoPorOmision(ahora: Date, zona: string): { desde: string; hasta: string } {
  const hoy = DateTime.fromJSDate(ahora, { zone: zona }).toISODate() ?? '';
  return { desde: sumarDias(hoy, 1), hasta: sumarDias(hoy, 3) };
}

export const TEXTO_SIN_APROBAR_VENCIDO = 'Sin aprobar — no se envió';
export const TEXTO_SIN_CORREO = 'Sin correo — usa WhatsApp';
export const TEXTO_TELEFONO_INVALIDO = 'Teléfono no válido para WhatsApp';
export const TEXTO_WHATSAPP_ABIERTO = 'WhatsApp abierto';
export const TEXTO_NO_SE_PUDO_ENVIAR = 'No se pudo enviar';

type Correo = RecordatorioCita['correo'];
type Whatsapp = RecordatorioCita['whatsapp'];

export function textoCorreo(correo: Correo): string {
  switch (correo.estado) {
    case 'sin_correo':
      return TEXTO_SIN_CORREO;
    case 'pendiente':
      return correo.sinAprobarYVencido ? TEXTO_SIN_APROBAR_VENCIDO : 'Sin aprobar';
    case 'aprobado':
      return 'Aprobado';
    case 'enviado':
      return 'Enviado';
    case 'fallido':
      return TEXTO_NO_SE_PUDO_ENVIAR;
    case 'anulado':
      return 'Anulado';
  }
}

/** Lo que hay que decir del WhatsApp, o `undefined` si solo está disponible. */
export function textoWhatsApp(w: Whatsapp): string | undefined {
  if (w.motivo === 'telefono_invalido') return TEXTO_TELEFONO_INVALIDO;
  return w.abierto ? TEXTO_WHATSAPP_ABIERTO : undefined;
}

export const ETIQUETA_RESPUESTA: Record<RespuestaPacienteValor, string> = {
  confirma: 'Confirmó',
  cancela: 'Canceló',
  pide_cambio: 'Pide cambio',
};

export function textoRespuesta(r: NonNullable<RecordatorioCita['respuesta']>): string {
  return r.origen === 'recepcion' ? `${ETIQUETA_RESPUESTA[r.valor]} (registrado por recepción)` : ETIQUETA_RESPUESTA[r.valor];
}

export interface GrupoMedico {
  medico: string;
  citas: RecordatorioCita[];
}
export interface GrupoFecha {
  fecha: string;
  medicos: GrupoMedico[];
}

/** Por fecha local y, dentro, por médico; fechas, médicos (por nombre) y citas (por hora) en orden. */
export function agruparPorFechaYMedico(citas: RecordatorioCita[]): GrupoFecha[] {
  const porFecha = new Map<string, Map<string, RecordatorioCita[]>>();
  for (const c of citas) {
    const medicos = porFecha.get(c.fecha) ?? new Map<string, RecordatorioCita[]>();
    medicos.set(c.medico, [...(medicos.get(c.medico) ?? []), c]);
    porFecha.set(c.fecha, medicos);
  }
  return [...porFecha.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, medicos]) => ({
      fecha,
      medicos: [...medicos.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'es'))
        .map(([medico, lista]) => ({ medico, citas: [...lista].sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio)) })),
    }));
}

/** Hay correos por aprobar: "Aprobar todos" tiene algo que hacer. */
export const hayPendientes = (citas: RecordatorioCita[]): boolean => citas.some((c) => c.correo.estado === 'pendiente');
