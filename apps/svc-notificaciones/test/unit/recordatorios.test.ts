import type { CitaParaRecordatorio, ConsultorioParaMensaje } from '@consultorio/contracts';
import { DateTime } from 'luxon';
import { describe, expect, test } from 'vitest';
import { enviableAhora, errorDeRango, recortarHora, sinAprobarYVencido } from '../../src/dominio/calendario.js';
import { PLANTILLAS_POR_OMISION } from '../../src/dominio/plantillas.js';
import { armarRecordatorio, cambiosDeConfig, type EnvioDeCita } from '../../src/dominio/recordatorios.js';

const ZONA = 'America/Mexico_City';
const en = (iso: string) => DateTime.fromISO(iso, { zone: ZONA });

describe('recortarHora', () => {
  test('quita los segundos del tipo time de Postgres', () => {
    expect(recortarHora('10:00:00')).toBe('10:00');
    expect(recortarHora('09:30')).toBe('09:30');
  });
});

describe('sinAprobarYVencido', () => {
  // Cita el martes 2030-01-08; el recordatorio sale el lunes 07 a las 10:00.
  const args = (ahora: string, o: { modo?: 'con_revision' | 'sin_revision'; estado?: Parameters<typeof sinAprobarYVencido>[5]; hora?: string } = {}) =>
    sinAprobarYVencido(en(ahora), ZONA, o.modo ?? 'con_revision', o.hora ?? '10:00', '2030-01-08', o.estado ?? 'pendiente');
  test('con revisión, pendiente y ya pasó la hora de envío del día anterior → true', () => {
    expect(args('2030-01-07T10:00:00')).toBe(true);
    expect(args('2030-01-08T08:00:00')).toBe(true);
  });
  test('antes de la hora de envío → false', () => {
    expect(args('2030-01-07T09:59:00')).toBe(false);
  });
  test('aprobado, enviado o en sin revisión → false', () => {
    expect(args('2030-01-07T11:00:00', { estado: 'aprobado' })).toBe(false);
    expect(args('2030-01-07T11:00:00', { estado: 'enviado' })).toBe(false);
    expect(args('2030-01-07T11:00:00', { modo: 'sin_revision' })).toBe(false);
  });
  test('hora de envío inválida → false (nunca un falso aviso)', () => {
    expect(args('2030-01-07T11:00:00', { hora: 'x' })).toBe(false);
  });
});

describe('enviableAhora', () => {
  const inicio = '2030-01-08T15:00:00.000Z'; // 09:00 local
  const f = (ahora: string, hora = '10:00', corridaHecha = false) => enviableAhora(en(ahora), ZONA, hora, '2030-01-08', inicio, corridaHecha);
  test('después de la hora de envío del día anterior y antes del inicio → true', () => {
    expect(f('2030-01-07T10:00:00')).toBe(true);
    expect(f('2030-01-08T08:59:00')).toBe(true);
  });
  test('antes de la hora de envío: lo enviará la corrida del día', () => {
    expect(f('2030-01-07T09:59:00')).toBe(false);
  });
  test('la cita ya empezó → false', () => {
    expect(f('2030-01-08T09:00:00')).toBe(false);
  });
  test('hora inválida → false', () => {
    expect(f('2030-01-07T11:00:00', 'x')).toBe(false);
  });
  test('la corrida de la víspera ya corrió aunque la hora se movió después → true (si no, nadie lo enviaría)', () => {
    // La corrida fue a las 10:00; luego la hora cambió a 18:00 y son las 13:00.
    expect(f('2030-01-07T13:00:00', '18:00', true)).toBe(true);
    expect(f('2030-01-07T13:00:00', '18:00', false)).toBe(false);
  });
  test('con corrida hecha, la cita que ya empezó sigue sin enviarse; hora inválida tampoco bloquea', () => {
    expect(f('2030-01-08T09:00:00', '18:00', true)).toBe(false);
    expect(f('2030-01-07T13:00:00', 'x', true)).toBe(true);
  });
});

const cita = (o: Partial<CitaParaRecordatorio> = {}): CitaParaRecordatorio => ({
  citaId: '0198f2a0-0000-7000-8000-000000000001',
  version: 1,
  inicio: '2030-01-08T15:00:00.000Z',
  fin: '2030-01-08T15:30:00.000Z',
  estado: 'agendada',
  pideCambio: false,
  medicoId: '0198f2a0-0000-7000-8000-000000000002',
  medicoNombre: 'Dra. Ruiz',
  tipoCitaNombre: 'Consulta',
  contacto: { nombre: 'Ana López', telefono: '5512345678', email: 'ana@example.com' },
  ...o,
});
const consultorio: ConsultorioParaMensaje = { nombreMostrado: 'Clínica Sol', telefono: '5598765432', colorPrimario: null, colorTexto: null, logoKey: null, zonaHoraria: ZONA, pais: 'MX' };
const config = { modo: 'con_revision' as const, horaEnvio: '10:00:00', plantillas: PLANTILLAS_POR_OMISION };
const armar = (c: CitaParaRecordatorio, envios: EnvioDeCita[], ahora = '2030-01-07T09:00:00', corridaHecha = false) => armarRecordatorio({ cita: c, consultorio, config, envios, ahora: en(ahora), corridaHecha });
const envio = (o: Partial<EnvioDeCita> = {}): EnvioDeCita => ({ canal: 'correo', estado: 'pendiente', respuesta: null, respondidoEn: null, respondidoPor: null, ...o });

describe('armarRecordatorio', () => {
  test('cita con correo pendiente: vista previa rellena y enlace de WhatsApp', () => {
    const r = armar(cita(), [envio()]);
    expect(r).toMatchObject({ citaId: cita().citaId, fecha: '2030-01-08', paciente: 'Ana López', medico: 'Dra. Ruiz', estadoCita: 'agendada', pideCambio: false, respuesta: null });
    expect(r.correo.estado).toBe('pendiente');
    expect(r.correo.sinAprobarYVencido).toBe(false);
    expect(r.correo.vistaPrevia?.asunto).toBe('Recordatorio de tu cita en Clínica Sol');
    expect(r.correo.vistaPrevia?.texto).toContain('Ana López');
    expect(r.correo.vistaPrevia?.texto).toContain('09:00');
    expect(r.whatsapp.abierto).toBe(false);
    expect(r.whatsapp.enlace).toMatch(/^https:\/\/wa\.me\/525512345678\?text=/);
    expect(r.whatsapp.motivo).toBeNull();
    expect(r.whatsapp.vistaPrevia).toContain('¿Nos confirmas tu asistencia?');
  });

  test('sin correo: estado sin_correo y sin vista previa del correo', () => {
    const r = armar(cita({ contacto: { nombre: 'Ana', telefono: '5512345678', email: null } }), []);
    expect(r.correo).toEqual({ estado: 'sin_correo', sinAprobarYVencido: false, enviableAhora: false, vistaPrevia: null });
    const vacio = armar(cita({ contacto: { nombre: 'Ana', telefono: '5512345678', email: '  ' } }), []);
    expect(vacio.correo.estado).toBe('sin_correo');
  });

  test('correo con email pero sin envío todavía se muestra pendiente', () => {
    expect(armar(cita(), []).correo.estado).toBe('pendiente');
  });

  test('teléfono no válido: sin enlace y con motivo', () => {
    const r = armar(cita({ contacto: { nombre: 'Ana', telefono: '123', email: null } }), []);
    expect(r.whatsapp).toMatchObject({ enlace: null, motivo: 'telefono_invalido' });
  });

  test('WhatsApp abierto cuando su envío está enviado', () => {
    expect(armar(cita(), [envio({ canal: 'whatsapp_asistido', estado: 'enviado' })]).whatsapp.abierto).toBe(true);
    expect(armar(cita(), [envio({ canal: 'whatsapp_asistido', estado: 'anulado' })]).whatsapp.abierto).toBe(false);
  });

  test('con revisión, pendiente y pasada la hora de envío → sinAprobarYVencido', () => {
    expect(armar(cita(), [envio()], '2030-01-07T11:00:00').correo.sinAprobarYVencido).toBe(true);
    expect(armar(cita(), [envio({ estado: 'aprobado' })], '2030-01-07T11:00:00').correo.sinAprobarYVencido).toBe(false);
  });

  test('enviableAhora: tras la hora de envío o con la corrida hecha, y solo mientras la cita no empieza', () => {
    expect(armar(cita(), [envio({ estado: 'aprobado' })], '2030-01-07T09:00:00').correo.enviableAhora).toBe(false);
    expect(armar(cita(), [envio({ estado: 'aprobado' })], '2030-01-07T10:00:00').correo.enviableAhora).toBe(true);
    expect(armar(cita(), [envio({ estado: 'aprobado' })], '2030-01-07T09:00:00', true).correo.enviableAhora).toBe(true);
    expect(armar(cita(), [envio({ estado: 'aprobado' })], '2030-01-08T09:00:00', true).correo.enviableAhora).toBe(false);
    expect(armar(cita({ contacto: { nombre: 'Ana', telefono: '5512345678', email: null } }), []).correo.enviableAhora).toBe(false);
  });

  test('respuesta: la más reciente entre canales; el origen sale de quién respondió', () => {
    const r = armar(cita(), [
      envio({ respuesta: 'confirma', respondidoEn: new Date('2030-01-07T16:00:00Z'), respondidoPor: 'paciente' }),
      envio({ canal: 'whatsapp_asistido', estado: 'enviado', respuesta: 'cancela', respondidoEn: new Date('2030-01-07T17:00:00Z'), respondidoPor: '0198f2a0-0000-7000-8000-0000000000aa' }),
    ]);
    expect(r.respuesta).toEqual({ valor: 'cancela', canal: 'whatsapp_asistido', origen: 'recepcion', respondidoEn: '2030-01-07T17:00:00.000Z' });
    const p = armar(cita(), [envio({ respuesta: 'pide_cambio', respondidoEn: new Date('2030-01-07T16:00:00Z'), respondidoPor: 'paciente' })]);
    expect(p.respuesta).toMatchObject({ valor: 'pide_cambio', canal: 'correo', origen: 'paciente' });
  });

  test('una respuesta sin fecha no se muestra', () => {
    expect(armar(cita(), [envio({ respuesta: 'confirma', respondidoEn: null })]).respuesta).toBeNull();
  });
});

describe('cambiosDeConfig', () => {
  const actual = { modo: 'con_revision' as const, horaEnvio: '10:00:00', plantillas: PLANTILLAS_POR_OMISION };
  test('combina lo recibido con lo actual y lista solo los campos que cambian', () => {
    const r = cambiosDeConfig(actual, { modo: 'sin_revision', horaEnvio: '10:00', plantillas: { whatsapp: 'Hola {paciente}' } });
    expect(r.nueva).toEqual({ modo: 'sin_revision', horaEnvio: '10:00', plantillas: { ...PLANTILLAS_POR_OMISION, whatsapp: 'Hola {paciente}' } });
    expect(r.campos).toEqual(['modo', 'plantillaWhatsapp']);
  });
  test('sin cambios → ningún campo', () => {
    expect(cambiosDeConfig(actual, { modo: 'con_revision', horaEnvio: '10:00' }).campos).toEqual([]);
    expect(cambiosDeConfig(actual, {}).campos).toEqual([]);
  });
  test('hora y plantillas de correo', () => {
    expect(cambiosDeConfig(actual, { horaEnvio: '08:30', plantillas: { correoAsunto: 'a', correoCuerpo: 'b' } }).campos).toEqual(['horaEnvio', 'plantillaCorreoAsunto', 'plantillaCorreoCuerpo']);
  });
});

describe('errorDeRango', () => {
  test('rango válido de 1 a maxDias inclusive', () => {
    expect(errorDeRango('2030-01-01', '2030-01-01', 7)).toBeNull();
    expect(errorDeRango('2030-01-01', '2030-01-07', 7)).toBeNull();
  });
  test('más de maxDias, invertido o fechas inválidas', () => {
    expect(errorDeRango('2030-01-01', '2030-01-08', 7)).toMatch(/1 a 7 días/);
    expect(errorDeRango('2030-01-08', '2030-01-07', 7)).toMatch(/1 a 7 días/);
    expect(errorDeRango('hoy', '2030-01-07', 7)).toBe('Fecha inválida');
    expect(errorDeRango('2030-02-30', '2030-03-01', 7)).toBe('Fecha inválida');
  });
});
