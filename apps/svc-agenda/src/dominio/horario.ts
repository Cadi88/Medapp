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
  const desde = inicio.hour * 60 + inicio.minute;
  const hasta = fin.hour * 60 + fin.minute;
  const dia = diaSemanaLocal(inicio);
  return bloques.some(
    (b) => b.diaSemana === dia && minutosDelDia(b.horaInicio) <= desde && hasta <= minutosDelDia(b.horaFin),
  );
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
