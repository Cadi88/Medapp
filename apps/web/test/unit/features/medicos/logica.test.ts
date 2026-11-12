import { describe, expect, test } from 'vitest';
import { instanteDesdeLocal, textoLocal } from '@/features/medicos/logica/bloqueos';
import { bloquesDeDia, DIAS, semanaDesdeFormulario, validarSemana } from '@/features/medicos/logica/semana';
import { altaBloqueoSchema, tipoCitaFormSchema } from '@/features/medicos/logica/validaciones';

function formulario(filas: [string, string, string][]) {
  const fd = new FormData();
  for (const [dia, inicio, fin] of filas) {
    fd.append('diaSemana', dia);
    fd.append('horaInicio', inicio);
    fd.append('horaFin', fin);
  }
  return fd;
}

describe('semanaDesdeFormulario', () => {
  test('arma bloques con el día numérico (0 = domingo) y omite filas vacías', () => {
    const fd = formulario([
      ['1', '09:00', '13:00'],
      ['1', '', ''],
      ['0', '10:00', '12:00'],
    ]);
    expect(semanaDesdeFormulario(fd)).toEqual([
      { diaSemana: 1, horaInicio: '09:00', horaFin: '13:00' },
      { diaSemana: 0, horaInicio: '10:00', horaFin: '12:00' },
    ]);
  });

  test('una fila a medias se conserva para que la validación la señale', () => {
    expect(semanaDesdeFormulario(formulario([['2', '09:00', '']]))).toEqual([{ diaSemana: 2, horaInicio: '09:00', horaFin: '' }]);
  });

  test('sin campos da una semana vacía', () => {
    expect(semanaDesdeFormulario(new FormData())).toEqual([]);
  });
});

describe('validarSemana', () => {
  const b = (diaSemana: number, horaInicio: string, horaFin: string) => ({ diaSemana, horaInicio, horaFin });

  test('acepta bloques contiguos o en días distintos y la semana vacía', () => {
    expect(validarSemana([])).toEqual({ ok: true });
    expect(validarSemana([b(1, '09:00', '13:00'), b(1, '13:00', '17:00'), b(2, '09:00', '13:00')])).toEqual({ ok: true });
  });

  test('detecta encimados antes de enviar, sin importar el orden', () => {
    const r = validarSemana([b(1, '12:00', '15:00'), b(1, '09:00', '13:00')]);
    expect(r).toEqual({ ok: false, error: 'Los bloques del lunes se enciman: 09:00–13:00 y 12:00–15:00' });
  });

  test('rechaza inicio >= fin, horas incompletas y formato inválido', () => {
    expect(validarSemana([b(1, '13:00', '09:00')])).toEqual({ ok: false, error: 'En lunes, la hora de inicio debe ser anterior al fin (13:00–09:00)' });
    expect(validarSemana([b(1, '09:00', '09:00')]).ok).toBe(false);
    expect(validarSemana([b(3, '09:00', '')])).toEqual({ ok: false, error: 'En miércoles, completa la hora de inicio y la de fin' });
    expect(validarSemana([b(3, '25:00', '26:00')])).toEqual({ ok: false, error: 'En miércoles, la hora debe tener el formato HH:mm' });
  });

  test('rechaza un día fuera de 0 a 6', () => {
    expect(validarSemana([b(7, '09:00', '10:00')])).toEqual({ ok: false, error: 'Día de la semana inválido' });
  });

  test('máximo 28 bloques, como el contrato', () => {
    const muchos = Array.from({ length: 29 }, (_, i) => b(i % 7, `${String(i % 10).padStart(2, '0')}:00`, `${String((i % 10) + 1).padStart(2, '0')}:00`));
    expect(validarSemana(muchos)).toEqual({ ok: false, error: 'Máximo 28 bloques por semana' });
  });
});

describe('DIAS y bloquesDeDia', () => {
  test('la semana empieza en lunes y el domingo es 0', () => {
    expect(DIAS.map((d) => d.valor)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(DIAS[6]?.nombre).toBe('Domingo');
  });

  test('bloquesDeDia filtra y ordena por hora de inicio', () => {
    const bloques = [
      { diaSemana: 1, horaInicio: '15:00', horaFin: '17:00' },
      { diaSemana: 2, horaInicio: '09:00', horaFin: '10:00' },
      { diaSemana: 1, horaInicio: '09:00', horaFin: '13:00' },
    ];
    expect(bloquesDeDia(bloques, 1).map((x) => x.horaInicio)).toEqual(['09:00', '15:00']);
  });
});

describe('instanteDesdeLocal / textoLocal', () => {
  test('convierte la hora del consultorio a ISO con desfase', () => {
    expect(instanteDesdeLocal('2026-11-12T10:00', 'America/Mexico_City')).toBe('2026-11-12T10:00:00.000-06:00');
  });

  test('un valor inválido da undefined', () => {
    expect(instanteDesdeLocal('', 'America/Mexico_City')).toBeUndefined();
    expect(instanteDesdeLocal('mañana', 'America/Mexico_City')).toBeUndefined();
  });

  test('textoLocal es lo inverso para mostrar', () => {
    expect(textoLocal('2026-11-12T16:00:00.000Z', 'America/Mexico_City')).toBe('12 nov 2026, 10:00');
  });
});

describe('esquemas de formulario', () => {
  test('tipo de cita: duración entera de 5 a 480 minutos', () => {
    expect(tipoCitaFormSchema.safeParse({ nombre: ' Consulta ', duracionMin: '30' }).data).toEqual({ nombre: 'Consulta', duracionMin: 30 });
    expect(tipoCitaFormSchema.safeParse({ nombre: 'x', duracionMin: '4' }).success).toBe(false);
    expect(tipoCitaFormSchema.safeParse({ nombre: 'x', duracionMin: '30.5' }).success).toBe(false);
    expect(tipoCitaFormSchema.safeParse({ nombre: '', duracionMin: '' }).success).toBe(false);
    expect(tipoCitaFormSchema.safeParse({ nombre: 'x'.repeat(81), duracionMin: '30' }).success).toBe(false);
  });

  test('bloqueo: el inicio debe ser anterior al fin y el motivo es opcional', () => {
    const base = { inicio: '2026-11-12T10:00', fin: '2026-11-12T12:00', motivo: '' };
    expect(altaBloqueoSchema.safeParse(base).data).toEqual({ inicio: base.inicio, fin: base.fin });
    expect(altaBloqueoSchema.safeParse({ ...base, motivo: ' Congreso ' }).data?.motivo).toBe('Congreso');
    const r = altaBloqueoSchema.safeParse({ ...base, fin: '2026-11-12T10:00' });
    expect(r.success).toBe(false);
    expect(altaBloqueoSchema.safeParse({ ...base, inicio: '' }).success).toBe(false);
  });
});
