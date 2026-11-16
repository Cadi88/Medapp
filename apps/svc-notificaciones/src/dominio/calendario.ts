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
  const dia = DateTime.fromISO(fechaCita, { zone: 'UTC' }).minus({ days: 1 });
  const fecha = dia.isValid ? dia.toISODate() : null;
  if (fecha === null) throw new Error(`Fecha de cita inválida: ${dia.invalidReason ?? 'fecha inválida'}`);
  return fecha;
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
  // Se compara la hora de pared: si `horaEnvio` cae en el hueco del cambio de horario (02:30 que no existe) sale en cuanto termina el hueco.
  if (local.hour * 60 + local.minute < Number(hora[1]) * 60 + Number(hora[2])) return null;
  return { fechaEnvio: hoy, fechaCitas: manana };
}

/** Estados que se envían según el modo (la misma regla que `debeEnviar`, para reclamarlos en SQL). */
export function estadosEnviables(modo: ModoRecordatorios): EstadoEnvio[] {
  return modo === 'sin_revision' ? ['aprobado', 'pendiente'] : ['aprobado'];
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

/**
 * Envío inmediato de una cita tardía: solo en sin_revision, si la cita cae mañana (zona del consultorio) y ya pasó la hora
 * de envío de hoy (si no, la corrida del día la incluirá). Devuelve la fecha local de la cita, o null si no aplica.
 */
export function debeEnviarInmediato(ahora: DateTime, zona: string, modo: ModoRecordatorios, horaEnvio: string, inicioIso: string): { fechaCita: string } | null {
  if (modo !== 'sin_revision') return null;
  // Sin corrida previa, corridaPendiente solo dice si ya pasó la hora de envío de hoy y cuál es la fecha de mañana.
  const hoy = corridaPendiente(ahora, zona, horaEnvio, null);
  if (!hoy) return null;
  const fechaCita = fechaCitaLocal(inicioIso, zona);
  return fechaCita === hoy.fechaCitas ? { fechaCita } : null;
}

/** `HH:mm:ss` (tipo `time` de Postgres) → `HH:mm`. */
export const recortarHora = (hora: string): string => hora.slice(0, 5);

/** Instante local en que sale el recordatorio de una cita: la víspera a `horaEnvio`. `null` ante hora, fecha o zona inválidas. */
function instanteDeEnvio(zona: string, horaEnvio: string, fechaCita: string): DateTime | null {
  const hora = HORA_ENVIO.exec(horaEnvio);
  if (!hora) return null;
  const instante = DateTime.fromISO(`${fechaDeEnvio(fechaCita)}T${hora[1]}:${hora[2]}`, { zone: zona });
  return instante.isValid ? instante : null;
}

/** "Sin aprobar — no se envió": en `con_revision`, el envío sigue `pendiente` y ya pasó la hora a la que debía salir. */
export function sinAprobarYVencido(ahora: DateTime, zona: string, modo: ModoRecordatorios, horaEnvio: string, fechaCita: string, estado: EstadoEnvio): boolean {
  if (modo !== 'con_revision' || estado !== 'pendiente') return false;
  const salida = instanteDeEnvio(zona, horaEnvio, fechaCita);
  return salida !== null && ahora >= salida;
}

/**
 * Un envío aprobado sale en ese momento si la cita aún no empieza y ya pasó su hora de envío, o la corrida de la víspera ya
 * corrió (`corridaHecha`: si la hora se movió después, esa corrida no volverá a pasar y nadie lo enviaría). Si no, lo enviará la corrida del día.
 */
export function enviableAhora(ahora: DateTime, zona: string, horaEnvio: string, fechaCita: string, inicioIso: string, corridaHecha: boolean): boolean {
  const inicio = DateTime.fromISO(inicioIso, { setZone: true });
  if (!inicio.isValid || ahora >= inicio) return false;
  if (corridaHecha) return true;
  const salida = instanteDeEnvio(zona, horaEnvio, fechaCita);
  return salida !== null && ahora >= salida;
}

/** Motivo por el que `desde`–`hasta` (fechas locales `YYYY-MM-DD`) no es un rango válido de a lo sumo `maxDias` días inclusive; `null` si lo es. */
export function errorDeRango(desde: string, hasta: string, maxDias: number): string | null {
  const d = DateTime.fromISO(desde, { zone: 'UTC' });
  const h = DateTime.fromISO(hasta, { zone: 'UTC' });
  if (!d.isValid || !h.isValid) return 'Fecha inválida';
  const dias = Math.round(h.diff(d, 'days').days) + 1;
  return dias < 1 || dias > maxDias ? `El rango debe ser de 1 a ${maxDias} días` : null;
}
