import { DateTime } from 'luxon';
import { describe, expect, test } from 'vitest';
import { corridaPendiente, debeEnviar, fechaCitaLocal, fechaDeEnvio, fechaYHoraLocal } from '../../src/dominio/calendario.js';

const TIJUANA = 'America/Tijuana';
const en = (iso: string, zona: string) => DateTime.fromISO(iso, { zone: zona });

describe('fechaCitaLocal / fechaDeEnvio', () => {
  test('usa la fecha local de la zona, no la UTC', () => {
    expect(fechaCitaLocal('2026-11-17T03:00:00Z', TIJUANA)).toBe('2026-11-16');
    expect(fechaCitaLocal('2026-11-17T03:00:00Z', 'UTC')).toBe('2026-11-17');
  });
  test('R4: zona inválida o ISO inválido lanzan un error claro (nunca una fecha nula disfrazada)', () => {
    expect(() => fechaCitaLocal('2026-11-17T03:00:00Z', 'No/Existe')).toThrow(/fecha de la cita/i);
    expect(() => fechaCitaLocal('no-es-iso', TIJUANA)).toThrow(/fecha de la cita/i);
  });
  test('fechaDeEnvio es el día anterior (cruza mes y año)', () => {
    expect(fechaDeEnvio('2026-11-16')).toBe('2026-11-15');
    expect(fechaDeEnvio('2026-12-01')).toBe('2026-11-30');
    expect(fechaDeEnvio('2027-01-01')).toBe('2026-12-31');
  });
});

describe('corridaPendiente', () => {
  test('Review Focus 3: Tijuana sábado 10:05 local → fechaCitas = domingo; 09:59 → null', () => {
    const sab1005 = en('2026-11-14T10:05:00', TIJUANA);
    expect(sab1005.weekday).toBe(6);
    expect(corridaPendiente(sab1005, TIJUANA, '10:00', null)).toEqual({ fechaEnvio: '2026-11-14', fechaCitas: '2026-11-15' });
    expect(corridaPendiente(en('2026-11-14T09:59:00', TIJUANA), TIJUANA, '10:00', null)).toBeNull();
  });
  test('justo a la hora de envío ya corresponde', () => {
    expect(corridaPendiente(en('2026-11-14T10:00:00', TIJUANA), TIJUANA, '10:00', null)).not.toBeNull();
  });
  test('ya corrió hoy → null; corrida de un día anterior → pendiente', () => {
    const ahora = en('2026-11-14T11:00:00', TIJUANA);
    expect(corridaPendiente(ahora, TIJUANA, '10:00', '2026-11-14')).toBeNull();
    expect(corridaPendiente(ahora, TIJUANA, '10:00', '2026-11-13')).toEqual({ fechaEnvio: '2026-11-14', fechaCitas: '2026-11-15' });
  });
  test('la zona del consultorio manda, no la del reloj: mismo instante, otra zona', () => {
    const instante = DateTime.fromISO('2026-11-14T18:05:00Z');
    expect(corridaPendiente(instante, TIJUANA, '10:00', null)).not.toBeNull(); // 10:05 en Tijuana
    expect(corridaPendiente(instante, 'America/Mexico_City', '10:00', null)).not.toBeNull(); // 12:05
    expect(corridaPendiente(instante, 'Asia/Tokyo', '10:00', null)).toBeNull(); // 03:05 del 15: aún no
  });
  test('fin de mes y de año', () => {
    expect(corridaPendiente(en('2026-12-31T12:00:00', 'UTC'), 'UTC', '10:00', null)).toEqual({ fechaEnvio: '2026-12-31', fechaCitas: '2027-01-01' });
  });
  test('acepta hora_envio con segundos (time de Postgres)', () => {
    expect(corridaPendiente(en('2026-11-14T10:05:00', TIJUANA), TIJUANA, '10:00:00', null)).not.toBeNull();
  });
});

describe('corridaPendiente con entradas inválidas (R4)', () => {
  const ahora = en('2026-11-14T11:00:00', TIJUANA);
  test('zona inválida → null', () => {
    expect(corridaPendiente(ahora, 'No/Existe', '10:00', null)).toBeNull();
  });
  test('instante inválido → null', () => {
    expect(corridaPendiente(DateTime.fromISO('basura'), TIJUANA, '10:00', null)).toBeNull();
  });
  test.each(['', 'diez', '25:00', '10:61', '10', '10:00:99', '1000'])('horaEnvio mal formada %j → null', (hora) => {
    expect(corridaPendiente(ahora, TIJUANA, hora, null)).toBeNull();
  });
});

describe('corridaPendiente en el día del cambio de horario (R4)', () => {
  // America/Tijuana retrocede el 2026-11-01 a las 02:00 PDT → 01:00 PST: la hora 01:30 ocurre dos veces.
  test('horaEnvio 01:30: antes de la primera ocurrencia → null; en la primera y en la repetida → corrida de ese día', () => {
    const esperado = { fechaEnvio: '2026-11-01', fechaCitas: '2026-11-02' };
    expect(corridaPendiente(DateTime.fromISO('2026-11-01T08:29:00Z'), TIJUANA, '01:30', null)).toBeNull(); // 01:29 PDT
    expect(corridaPendiente(DateTime.fromISO('2026-11-01T08:30:00Z'), TIJUANA, '01:30', null)).toEqual(esperado); // 01:30 PDT
    expect(corridaPendiente(DateTime.fromISO('2026-11-01T09:45:00Z'), TIJUANA, '01:30', null)).toEqual(esperado); // 01:45 PST (repetida)
    expect(corridaPendiente(DateTime.fromISO('2026-11-01T09:45:00Z'), TIJUANA, '01:30', '2026-11-01')).toBeNull(); // ya corrió
  });
});

describe('fechaYHoraLocal', () => {
  test('fecha y hora en español de la zona del consultorio', () => {
    expect(fechaYHoraLocal('2026-11-17T03:00:00Z', TIJUANA)).toEqual({ fecha: 'lunes 16 de noviembre', hora: '19:00' });
  });
  test('lanza ante zona o instante inválidos', () => {
    expect(() => fechaYHoraLocal('2026-11-17T03:00:00Z', 'No/Existe')).toThrow(/fecha de la cita/i);
    expect(() => fechaYHoraLocal('basura', TIJUANA)).toThrow(/fecha de la cita/i);
  });
});

describe('debeEnviar', () => {
  test('con_revision solo aprobado', () => {
    expect(debeEnviar({ estado: 'aprobado' }, 'con_revision')).toBe(true);
    expect(debeEnviar({ estado: 'pendiente' }, 'con_revision')).toBe(false);
  });
  test('sin_revision pendiente y aprobado', () => {
    expect(debeEnviar({ estado: 'pendiente' }, 'sin_revision')).toBe(true);
    expect(debeEnviar({ estado: 'aprobado' }, 'sin_revision')).toBe(true);
  });
  test.each(['enviado', 'anulado', 'fallido'] as const)('nunca %s', (estado) => {
    expect(debeEnviar({ estado }, 'con_revision')).toBe(false);
    expect(debeEnviar({ estado }, 'sin_revision')).toBe(false);
  });
});
