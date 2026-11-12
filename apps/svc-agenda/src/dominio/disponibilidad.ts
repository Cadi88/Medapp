import { DateTime } from 'luxon';
import { seEnciman } from './horario.js';
import { diaSemanaLocal, minutosDelDia } from './tiempo.js';
import type { BloqueHorario, Rango } from './tipos.js';

export interface EntradaHuecos {
  fecha: string; // 'YYYY-MM-DD' en la zona del consultorio
  zona: string;
  bloques: BloqueHorario[];
  /** Citas no canceladas y bloqueos. */
  ocupados: Rango[];
  duracionMin: number;
  ahora: DateTime;
}

/** Inicios libres (ISO UTC, ordenados) del día local `fecha`, cada `duracionMin` dentro de cada bloque. */
export function huecosLibres(i: EntradaHuecos): string[] {
  const dia = DateTime.fromISO(i.fecha, { zone: i.zona });
  if (!dia.isValid) throw new Error(`Fecha inválida: ${i.fecha}`);
  const delDia = i.bloques.filter((b) => b.diaSemana === diaSemanaLocal(dia));

  const inicios: DateTime[] = [];
  for (const b of delDia) {
    const fin = minutosDelDia(b.horaFin);
    for (let m = minutosDelDia(b.horaInicio); m + i.duracionMin <= fin; m += i.duracionMin) {
      const hora = Math.floor(m / 60);
      const minuto = m % 60;
      const inicio = DateTime.fromObject(
        { year: dia.year, month: dia.month, day: dia.day, hour: hora, minute: minuto },
        { zone: i.zona },
      );
      // Luxon corre hacia adelante las horas locales inexistentes (salto de horario): se omiten.
      if (!inicio.isValid || inicio.hour !== hora || inicio.minute !== minuto) continue;
      inicios.push(inicio.toUTC());
    }
  }

  return inicios
    .sort((a, b) => a.toMillis() - b.toMillis())
    .filter((inicio) => inicio >= i.ahora)
    .filter((inicio) => {
      const slot = { inicio, fin: inicio.plus({ minutes: i.duracionMin }) };
      return !i.ocupados.some((o) => seEnciman(slot, o));
    })
    .map((inicio) => inicio.toISO()!);
}
