import { DateTime } from 'luxon';

export type ModoRecordatorios = 'con_revision' | 'sin_revision';
export type EstadoEnvio = 'pendiente' | 'aprobado' | 'enviado' | 'fallido' | 'anulado';

/** Fecha local (`YYYY-MM-DD`) de una cita en la zona del consultorio. Lanza si el instante o la zona no son válidos. */
export function fechaCitaLocal(inicioIso: string, zona: string): string {
  const local = DateTime.fromISO(inicioIso, { setZone: true }).setZone(zona);
  const fecha = local.isValid ? local.toISODate() : null;
  if (fecha === null) throw new Error(`No se pudo calcular la fecha de la cita (${local.invalidReason ?? 'fecha inválida'})`);
  return fecha;
}

/** El recordatorio sale el día anterior a la cita (todos los días, domingo incluido). */
export function fechaDeEnvio(fechaCita: string): string {
  return DateTime.fromISO(fechaCita, { zone: 'UTC' }).minus({ days: 1 }).toISODate()!;
}

const HORA_ENVIO = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/**
 * Corrida automática de hoy (fecha local del consultorio) si ya pasó `horaEnvio` (`HH:mm` o `HH:mm:ss`) y no se hizo; `null` también ante zona, instante u hora inválidos.
 * `fechaCitas` es mañana local. `ahora` llega de fuera: el dominio no lee el reloj.
 */
export function corridaPendiente(
  ahora: DateTime,
  zona: string,
  horaEnvio: string,
  ultimaCorrida: string | null,
): { fechaEnvio: string; fechaCitas: string } | null {
  const hora = HORA_ENVIO.exec(horaEnvio);
  const local = ahora.setZone(zona);
  // Entrada inválida (instante, zona u hora): nunca una corrida con fechas nulas disfrazadas de texto.
  if (!hora || !local.isValid) return null;
  const hoy = local.toISODate();
  const manana = local.plus({ days: 1 }).toISODate();
  if (hoy === null || manana === null) return null;
  if (ultimaCorrida !== null && ultimaCorrida >= hoy) return null;
  if (local < local.startOf('day').set({ hour: Number(hora[1]), minute: Number(hora[2]) })) return null;
  return { fechaEnvio: hoy, fechaCitas: manana };
}

/** `con_revision` solo envía lo aprobado; `sin_revision` también lo pendiente. Lo enviado, fallido o anulado nunca. */
export function debeEnviar(envio: { estado: EstadoEnvio }, modo: ModoRecordatorios): boolean {
  if (envio.estado === 'aprobado') return true;
  return envio.estado === 'pendiente' && modo === 'sin_revision';
}

/** Fecha y hora de una cita en la zona del consultorio, para las plantillas (`es-MX`). Lanza si el instante o la zona no son válidos. */
export function fechaYHoraLocal(inicioIso: string, zona: string): { fecha: string; hora: string } {
  const local = DateTime.fromISO(inicioIso, { setZone: true }).setZone(zona).setLocale('es-MX');
  if (!local.isValid) throw new Error(`No se pudo calcular la fecha de la cita (${local.invalidReason ?? 'fecha inválida'})`);
  return { fecha: local.toFormat("cccc d 'de' LLLL"), hora: local.toFormat('HH:mm') };
}
