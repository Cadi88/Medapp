import type { BloqueHorarioDto } from '@consultorio/contracts';

/** Lunes a domingo; el valor es el `diaSemana` de la API (0 = domingo). */
export const DIAS = [
  { valor: 1, nombre: 'Lunes' },
  { valor: 2, nombre: 'Martes' },
  { valor: 3, nombre: 'Miércoles' },
  { valor: 4, nombre: 'Jueves' },
  { valor: 5, nombre: 'Viernes' },
  { valor: 6, nombre: 'Sábado' },
  { valor: 0, nombre: 'Domingo' },
] as const;

/** Mismo máximo que el contrato (`semanaSchema`). */
const MAX_BLOQUES = 28;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const nombreDelDia = (dia: number) => DIAS.find((d) => d.valor === dia)?.nombre.toLowerCase() ?? String(dia);
const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/**
 * Bloques desde los campos repetidos `diaSemana`, `horaInicio` y `horaFin` (una terna por fila). Las filas sin
 * ninguna hora se omiten; una fila a medias se conserva para que `validarSemana` la señale.
 */
export function semanaDesdeFormulario(fd: FormData): BloqueHorarioDto[] {
  const texto = (campo: string) => fd.getAll(campo).map((v) => (typeof v === 'string' ? v.trim() : ''));
  const dias = texto('diaSemana');
  const inicios = texto('horaInicio');
  const fines = texto('horaFin');
  return dias.flatMap((dia, i) => {
    const horaInicio = inicios[i] ?? '';
    const horaFin = fines[i] ?? '';
    return horaInicio === '' && horaFin === '' ? [] : [{ diaSemana: Number(dia), horaInicio, horaFin }];
  });
}

/** Bloques de un día, por hora de inicio. */
export function bloquesDeDia(bloques: BloqueHorarioDto[], dia: number): BloqueHorarioDto[] {
  return bloques.filter((b) => b.diaSemana === dia).sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
}

/**
 * Primera barrera de validación en el formulario (mismas reglas que `validarSemana` de `svc-agenda`, con textos
 * para la persona). La autoridad es el servicio y, al final, la restricción `EXCLUDE` de la base.
 */
export function validarSemana(bloques: BloqueHorarioDto[]): { ok: true } | { ok: false; error: string } {
  if (bloques.length > MAX_BLOQUES) return { ok: false, error: `Máximo ${MAX_BLOQUES} bloques por semana` };
  for (const b of bloques) {
    if (!Number.isInteger(b.diaSemana) || b.diaSemana < 0 || b.diaSemana > 6) return { ok: false, error: 'Día de la semana inválido' };
    const dia = nombreDelDia(b.diaSemana);
    if (b.horaInicio === '' || b.horaFin === '') return { ok: false, error: `En ${dia}, completa la hora de inicio y la de fin` };
    if (!HHMM.test(b.horaInicio) || !HHMM.test(b.horaFin)) return { ok: false, error: `En ${dia}, la hora debe tener el formato HH:mm` };
    if (minutos(b.horaInicio) >= minutos(b.horaFin)) {
      return { ok: false, error: `En ${dia}, la hora de inicio debe ser anterior al fin (${b.horaInicio}–${b.horaFin})` };
    }
  }
  const ordenados = [...bloques].sort((x, y) => x.diaSemana - y.diaSemana || minutos(x.horaInicio) - minutos(y.horaInicio));
  for (let i = 1; i < ordenados.length; i++) {
    const previo = ordenados[i - 1] as BloqueHorarioDto;
    const actual = ordenados[i] as BloqueHorarioDto;
    if (previo.diaSemana === actual.diaSemana && minutos(actual.horaInicio) < minutos(previo.horaFin)) {
      return {
        ok: false,
        error: `Los bloques del ${nombreDelDia(actual.diaSemana)} se enciman: ${previo.horaInicio}–${previo.horaFin} y ${actual.horaInicio}–${actual.horaFin}`,
      };
    }
  }
  return { ok: true };
}
