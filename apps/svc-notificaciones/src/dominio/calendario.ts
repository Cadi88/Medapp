import { DateTime } from 'luxon';

export type ModoRecordatorios = 'con_revision' | 'sin_revision';
export type EstadoEnvio = 'pendiente' | 'aprobado' | 'enviado' | 'fallido' | 'anulado';

/** Fecha local (`YYYY-MM-DD`) de una cita en la zona del consultorio. */
export function fechaCitaLocal(inicioIso: string, zona: string): string {
  return DateTime.fromISO(inicioIso, { setZone: true }).setZone(zona).toISODate()!;
}

/** El recordatorio sale el día anterior a la cita (todos los días, domingo incluido). */
export function fechaDeEnvio(fechaCita: string): string {
  return DateTime.fromISO(fechaCita, { zone: 'UTC' }).minus({ days: 1 }).toISODate()!;
}

/**
 * Corrida automática de hoy (fecha local del consultorio) si ya pasó `horaEnvio` (`HH:mm` o `HH:mm:ss`) y no se hizo.
 * `fechaCitas` es mañana local. `ahora` llega de fuera: el dominio no lee el reloj.
 */
export function corridaPendiente(
  ahora: DateTime,
  zona: string,
  horaEnvio: string,
  ultimaCorrida: string | null,
): { fechaEnvio: string; fechaCitas: string } | null {
  const local = ahora.setZone(zona);
  const hoy = local.toISODate()!;
  if (ultimaCorrida !== null && ultimaCorrida >= hoy) return null;
  const [h, m] = horaEnvio.split(':').map(Number) as [number, number];
  if (local < local.startOf('day').set({ hour: h, minute: m })) return null;
  return { fechaEnvio: hoy, fechaCitas: local.plus({ days: 1 }).toISODate()! };
}

/** `con_revision` solo envía lo aprobado; `sin_revision` también lo pendiente. Lo enviado, fallido o anulado nunca. */
export function debeEnviar(envio: { estado: EstadoEnvio }, modo: ModoRecordatorios): boolean {
  if (envio.estado === 'aprobado') return true;
  return envio.estado === 'pendiente' && modo === 'sin_revision';
}
