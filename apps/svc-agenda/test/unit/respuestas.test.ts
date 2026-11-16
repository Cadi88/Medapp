import { describe, expect, test } from 'vitest';
import { decidirRespuesta } from '../../src/dominio/respuestas.js';
import type { EstadoCita } from '../../src/dominio/tipos.js';

const INICIO = '2030-01-08T16:00:00.000Z';
const cita = (estado: EstadoCita, extra: { pideCambio?: boolean; inicio?: string } = {}) => ({ estado, inicio: extra.inicio ?? INICIO, pideCambio: extra.pideCambio ?? false });
const resp = (respuesta: 'confirma' | 'cancela' | 'pide_cambio', inicioCita = INICIO) => ({ respuesta, inicioCita });

describe('decidirRespuesta', () => {
  test.each([
    ['agendada', 'confirma', 'confirmar'],
    ['confirmada', 'cancela', 'cancelar'],
    ['agendada', 'cancela', 'cancelar'],
    ['agendada', 'pide_cambio', 'marcar_cambio'],
    ['confirmada', 'pide_cambio', 'marcar_cambio'],
  ] as const)('%s + %s → %s', (estado, r, accion) => {
    expect(decidirRespuesta(cita(estado), resp(r))).toEqual({ accion });
  });

  test('confirma sobre confirmada → ignorar sin_efecto', () => {
    expect(decidirRespuesta(cita('confirmada'), resp('confirma'))).toEqual({ accion: 'ignorar', motivo: 'sin_efecto' });
  });

  test('pide_cambio cuando ya lo pidió → ignorar sin_efecto', () => {
    expect(decidirRespuesta(cita('agendada', { pideCambio: true }), resp('pide_cambio'))).toEqual({ accion: 'ignorar', motivo: 'sin_efecto' });
  });

  test.each(['atendida', 'cancelada', 'no_asistio'] as const)('Review Focus 5: cualquier respuesta sobre %s → ignorar estado_final', (estado) => {
    for (const r of ['confirma', 'cancela', 'pide_cambio'] as const) {
      expect(decidirRespuesta(cita(estado), resp(r))).toEqual({ accion: 'ignorar', motivo: 'estado_final' });
    }
  });

  test('respuesta con inicioCita distinto (reprogramada) → ignorar reprogramada, aunque el estado sea final', () => {
    expect(decidirRespuesta(cita('agendada'), resp('cancela', '2030-01-09T16:00:00.000Z'))).toEqual({ accion: 'ignorar', motivo: 'reprogramada' });
    expect(decidirRespuesta(cita('cancelada'), resp('cancela', '2030-01-09T16:00:00.000Z'))).toEqual({ accion: 'ignorar', motivo: 'reprogramada' });
  });

  test('compara instantes, no cadenas: mismo instante con otro desfase no es reprogramada', () => {
    expect(decidirRespuesta(cita('agendada'), resp('confirma', '2030-01-08T10:00:00-06:00'))).toEqual({ accion: 'confirmar' });
  });
});
