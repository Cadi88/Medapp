import { describe, expect, test } from 'vitest';
import type { Cita, MedicoAgenda, TipoCita } from '@consultorio/contracts';
import { citasAEventos } from '@/features/agenda/logica/eventos-calendario';
import { mensajeDeError } from '@/features/agenda/logica/errores';
import { estadosSiguientes, esReprogramable } from '@/features/agenda/logica/estados';
import { fechaLocal, formatearHora, formatearRango, rangoDelDia } from '@/features/agenda/logica/formato';

const MEDICO = '0190a0a0-0000-7000-8000-00000000000a';
const TIPO = '0190a0a0-0000-7000-8000-00000000000b';
const medicos: MedicoAgenda[] = [{ usuarioId: MEDICO, nombre: 'Dra. Ruiz' }];
const tipos: TipoCita[] = [{ id: TIPO, medicoId: MEDICO, nombre: 'Consulta', duracionMin: 30, activo: true }];

const cita = (extra: Partial<Cita> = {}): Cita => ({
  id: '0190a0a0-0000-7000-8000-0000000000c1',
  medicoId: MEDICO,
  tipoCitaId: TIPO,
  // 16:00Z = 10:00 en Ciudad de México (UTC-6, sin horario de verano desde 2022)
  inicio: '2026-11-12T16:00:00.000Z',
  fin: '2026-11-12T16:30:00.000Z',
  estado: 'agendada',
  contacto: { nombre: 'Ana Pérez', telefono: '5551234567' },
  fueraDeHorario: false,
  version: 1,
  ...extra,
});

describe('citasAEventos', () => {
  test('título con contacto y tipo; instantes y datos de la cita en extendedProps', () => {
    const [e] = citasAEventos([cita()], medicos, 'America/Mexico_City', tipos);
    expect(e).toMatchObject({
      id: '0190a0a0-0000-7000-8000-0000000000c1',
      title: 'Ana Pérez · Consulta',
      start: '2026-11-12T16:00:00.000Z',
      end: '2026-11-12T16:30:00.000Z',
      editable: true,
    });
    expect(e?.extendedProps).toMatchObject({ estado: 'agendada', medico: 'Dra. Ruiz', version: 1 });
  });

  test('sin tipo conocido el título es solo el contacto', () => {
    expect(citasAEventos([cita()], medicos, 'America/Mexico_City')[0]?.title).toBe('Ana Pérez');
  });

  test('cancelada no es editable y tiene el color de cancelada', () => {
    const [agendada, cancelada] = citasAEventos(
      [cita(), cita({ id: '0190a0a0-0000-7000-8000-0000000000c2', estado: 'cancelada' })],
      medicos,
      'America/Mexico_City',
    );
    expect(cancelada?.editable).toBe(false);
    expect(cancelada?.backgroundColor).not.toBe(agendada?.backgroundColor);
    expect(cancelada?.backgroundColor).toBe('#dc2626');
  });

  test.each([
    ['agendada', true],
    ['confirmada', true],
    ['atendida', false],
    ['no_asistio', false],
    ['cancelada', false],
  ] as const)('editable según estado: %s → %s', (estado, editable) => {
    expect(citasAEventos([cita({ estado })], medicos, 'America/Mexico_City')[0]?.editable).toBe(editable);
  });

  test('la hora que se muestra es la de la zona del consultorio', () => {
    const [e] = citasAEventos([cita()], medicos, 'America/Mexico_City');
    expect(e?.extendedProps?.horaLocal).toBe('10:00');
    const [t] = citasAEventos([cita()], medicos, 'America/Tijuana');
    expect(t?.extendedProps?.horaLocal).toBe('08:00');
  });

  test('un médico desconocido no rompe el mapeo', () => {
    const [e] = citasAEventos([cita({ medicoId: '0190a0a0-0000-7000-8000-0000000000ff' })], medicos, 'America/Mexico_City');
    expect(e?.extendedProps?.medico).toBe('');
  });
});

describe('mensajeDeError', () => {
  test.each([
    ['HORARIO_OCUPADO', 'Ese horario ya se ocupó, elige otro'],
    ['HORARIO_BLOQUEADO', 'El médico tiene ese horario bloqueado'],
    ['CONFLICTO_VERSION', 'Alguien modificó esta cita'],
    ['FUERA_DE_HORARIO', 'El horario queda fuera de la jornada del médico'],
    ['CONFLICTO', 'Ese cambio de estado ya no es posible para esta cita'],
    ['VALIDACION', 'Revisa los datos del formulario'],
    ['PROHIBIDO', 'No tienes acceso'],
    ['NO_ENCONTRADO', 'La cita ya no existe'],
  ])('%s', (code, texto) => {
    expect(mensajeDeError(code)).toBe(texto);
  });

  test('códigos desconocidos o internos dan un aviso genérico sin detalles', () => {
    expect(mensajeDeError('INTERNO')).toBe('Ocurrió un error. Intenta de nuevo.');
    expect(mensajeDeError('ALGO_RARO')).toBe('Ocurrió un error. Intenta de nuevo.');
  });
});

describe('estados', () => {
  test('transiciones permitidas', () => {
    expect(estadosSiguientes('agendada')).toEqual(['confirmada', 'atendida', 'no_asistio', 'cancelada']);
    expect(estadosSiguientes('confirmada')).toEqual(['atendida', 'no_asistio', 'cancelada']);
    for (const final of ['atendida', 'no_asistio', 'cancelada'] as const) expect(estadosSiguientes(final)).toEqual([]);
  });
  test('solo agendada y confirmada se reprograman', () => {
    expect(esReprogramable('agendada')).toBe(true);
    expect(esReprogramable('confirmada')).toBe(true);
    expect(esReprogramable('atendida')).toBe(false);
  });
});

describe('formato', () => {
  test('formatearRango en es-MX y zona del consultorio', () => {
    const t = formatearRango('2026-11-12T16:00:00.000Z', '2026-11-12T16:30:00.000Z', 'America/Mexico_City');
    expect(t).toContain('10:00');
    expect(t).toContain('10:30');
    expect(t.toLowerCase()).toContain('nov');
  });
  test('formatearHora', () => {
    expect(formatearHora('2026-11-12T16:00:00.000Z', 'America/Mexico_City')).toBe('10:00');
  });
  test('fechaLocal respeta la zona (cruce de medianoche UTC)', () => {
    expect(fechaLocal('2026-11-13T03:00:00.000Z', 'America/Mexico_City')).toBe('2026-11-12');
    expect(fechaLocal('2026-11-13T07:00:00.000Z', 'UTC')).toBe('2026-11-13');
  });
  test('rangoDelDia: del inicio al fin del día local en UTC', () => {
    expect(rangoDelDia('2026-11-12', 'America/Mexico_City')).toEqual({
      desde: '2026-11-12T06:00:00.000Z',
      hasta: '2026-11-13T06:00:00.000Z',
    });
  });
});
