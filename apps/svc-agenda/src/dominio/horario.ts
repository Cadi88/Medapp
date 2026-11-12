import { DateTime } from 'luxon';
import { diaSemanaLocal, minutosDelDia } from './tiempo.js';
import type { BloqueHorario, Rango } from './tipos.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Semiabierto `[inicio, fin)`: dos rangos contiguos no se enciman. */
export function seEnciman(a: Rango, b: Rango): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/**
 * El rango completo debe caber en un solo bloque del día local de su inicio.
 * Si termina en otro día local (p. ej. cruza la medianoche), nunca encaja.
 */
export function encajaEnHorario(r: Rango, bloques: BloqueHorario[], zona: string): boolean {
  const inicio = r.inicio.setZone(zona);
  const fin = r.fin.setZone(zona);
  if (!inicio.hasSame(fin, 'day')) return false;
  const dia = diaSemanaLocal(inicio);
  // Se compara en instantes reales: en un cambio de horario el reloj local puede retroceder o saltar.
  return bloques.some(
    (b) =>
      b.diaSemana === dia &&
      instanteLocal(inicio, b.horaInicio, zona) <= r.inicio &&
      r.fin <= instanteLocal(inicio, b.horaFin, zona),
  );
}

function instanteLocal(dia: DateTime, hhmm: string, zona: string): DateTime {
  const m = minutosDelDia(hhmm);
  const hora = Math.floor(m / 60);
  const minuto = m % 60;
  const t = DateTime.fromObject({ year: dia.year, month: dia.month, day: dia.day, hour: hora, minute: minuto }, { zone: zona });
  // Hora local ambigua (retroceso de reloj): Luxon puede elegir cualquiera; se usa siempre la primera ocurrencia.
  for (const horas of [1, 2]) {
    const previa = t.minus({ hours: horas });
    if (previa.hour === hora && previa.minute === minuto) return previa;
  }
  return t;
}

/** Primera barrera de validación; la restricción `EXCLUDE` de la base es la definitiva. */
export function validarSemana(bloques: BloqueHorario[]): { ok: true } | { ok: false; error: string } {
  for (const b of bloques) {
    if (!Number.isInteger(b.diaSemana) || b.diaSemana < 0 || b.diaSemana > 6) {
      return { ok: false, error: `Día de la semana inválido: ${b.diaSemana}` };
    }
    if (!HHMM.test(b.horaInicio) || !HHMM.test(b.horaFin)) {
      return { ok: false, error: `Formato de hora inválido (HH:mm): ${b.horaInicio}–${b.horaFin}` };
    }
    if (minutosDelDia(b.horaInicio) >= minutosDelDia(b.horaFin)) {
      return { ok: false, error: `La hora de inicio debe ser anterior al fin: ${b.horaInicio}–${b.horaFin}` };
    }
  }
  const ordenados = [...bloques].sort(
    (x, y) => x.diaSemana - y.diaSemana || minutosDelDia(x.horaInicio) - minutosDelDia(y.horaInicio),
  );
  for (let i = 1; i < ordenados.length; i++) {
    const prev = ordenados[i - 1]!;
    const cur = ordenados[i]!;
    if (prev.diaSemana === cur.diaSemana && minutosDelDia(cur.horaInicio) < minutosDelDia(prev.horaFin)) {
      return { ok: false, error: `Bloques encimados el día ${cur.diaSemana}: ${prev.horaInicio}–${prev.horaFin} y ${cur.horaInicio}–${cur.horaFin}` };
    }
  }
  return { ok: true };
}
