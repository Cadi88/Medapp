import { describe, expect, test } from 'vitest';
import {
  agruparPorFechaYMedico,
  hayPendientes,
  rangoPorOmision,
  textoCorreo,
  textoRespuesta,
  textoWhatsApp,
} from '@/features/recordatorios/logica/presentacion';
import { CITA_B, CITA_C, recordatorio } from './apoyo';

const ZONA = 'America/Mexico_City';

describe('rangoPorOmision', () => {
  test('mañana y los dos días siguientes, en la zona del consultorio', () => {
    // 2026-11-16 03:00Z sigue siendo el 15 en Ciudad de México (UTC-6)
    expect(rangoPorOmision(new Date('2026-11-16T03:00:00Z'), ZONA)).toEqual({ desde: '2026-11-16', hasta: '2026-11-18' });
  });

  test('cruza el fin de mes', () => {
    expect(rangoPorOmision(new Date('2026-11-29T18:00:00Z'), ZONA)).toEqual({ desde: '2026-11-30', hasta: '2026-12-02' });
  });
});

describe('textoCorreo', () => {
  const correo = (extra: Partial<ReturnType<typeof recordatorio>['correo']>) => ({ ...recordatorio().correo, ...extra });

  test.each([
    [{ estado: 'sin_correo' as const, vistaPrevia: null }, 'Sin correo — usa WhatsApp'],
    [{ estado: 'pendiente' as const, sinAprobarYVencido: true }, 'Sin aprobar — no se envió'],
    [{ estado: 'pendiente' as const }, 'Sin aprobar'],
    [{ estado: 'aprobado' as const }, 'Aprobado'],
    [{ estado: 'enviado' as const }, 'Enviado'],
    [{ estado: 'fallido' as const }, 'No se pudo enviar'],
    [{ estado: 'anulado' as const }, 'Anulado'],
  ])('%j → %s', (extra, texto) => {
    expect(textoCorreo(correo(extra))).toBe(texto);
  });
});

describe('textoWhatsApp', () => {
  const w = recordatorio().whatsapp;
  test('abierto, teléfono no válido o nada que decir', () => {
    expect(textoWhatsApp({ ...w, abierto: true })).toBe('WhatsApp abierto');
    expect(textoWhatsApp({ ...w, enlace: null, motivo: 'telefono_invalido' })).toBe('Teléfono no válido para WhatsApp');
    expect(textoWhatsApp(w)).toBeUndefined();
  });
});

describe('textoRespuesta', () => {
  test('el valor y quién lo registró', () => {
    const base = { canal: 'correo' as const, respondidoEn: '2026-11-15T20:00:00.000Z' };
    expect(textoRespuesta({ ...base, valor: 'confirma', origen: 'paciente' })).toBe('Confirmó');
    expect(textoRespuesta({ ...base, valor: 'cancela', origen: 'paciente' })).toBe('Canceló');
    expect(textoRespuesta({ ...base, valor: 'pide_cambio', origen: 'recepcion' })).toBe('Pide cambio (registrado por recepción)');
  });
});

describe('agruparPorFechaYMedico', () => {
  test('por fecha y por médico, citas en orden de hora', () => {
    const citas = [
      recordatorio({ citaId: CITA_B, fecha: '2026-11-17', inicio: '2026-11-17T17:00:00.000Z', medico: 'Dr. Soto' }),
      recordatorio({ citaId: CITA_C, inicio: '2026-11-16T18:00:00.000Z' }),
      recordatorio(),
    ];
    const grupos = agruparPorFechaYMedico(citas);
    expect(grupos.map((g) => g.fecha)).toEqual(['2026-11-16', '2026-11-17']);
    expect(grupos[0]?.medicos).toHaveLength(1);
    expect(grupos[0]?.medicos[0]?.citas.map((c) => c.inicio)).toEqual(['2026-11-16T16:00:00.000Z', '2026-11-16T18:00:00.000Z']);
    expect(grupos[1]?.medicos[0]?.medico).toBe('Dr. Soto');
  });

  test('sin citas no hay grupos', () => {
    expect(agruparPorFechaYMedico([])).toEqual([]);
  });
});

describe('hayPendientes', () => {
  test('solo cuenta correos sin aprobar', () => {
    expect(hayPendientes([recordatorio()])).toBe(true);
    expect(hayPendientes([recordatorio({ correo: { estado: 'enviado', sinAprobarYVencido: false, enviableAhora: false, vistaPrevia: null } })])).toBe(false);
  });
});
