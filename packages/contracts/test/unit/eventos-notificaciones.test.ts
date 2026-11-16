import { describe, expect, test } from 'vitest';
import {
  CitaCancelada,
  CitaEstadoCambiado,
  CitaRespuestaPaciente,
  ConfigRecordatoriosActualizada,
  citaParaRecordatorioSchema,
  consultorioParaMensajeSchema,
} from '../../src/index.js';

const id = '0190a0a0-0000-7000-8000-000000000001';
const base = { tenantId: id, actorId: null, traceId: 't' };
const inst = '2030-01-07T17:00:00.000Z';

describe('eventos de agenda extendidos', () => {
  test('CitaEstadoCambiado acepta pideCambio y origen opcionales y sigue siendo v1', () => {
    const sin = CitaEstadoCambiado.create({ ...base, data: { citaId: id, medicoId: id, de: 'agendada', a: 'confirmada' } });
    const con = CitaEstadoCambiado.create({ ...base, data: { citaId: id, medicoId: id, de: 'agendada', a: 'confirmada', pideCambio: true, origen: 'paciente' } });
    expect(CitaEstadoCambiado.version).toBe(1);
    expect(CitaEstadoCambiado.parse(sin).data).not.toHaveProperty('pideCambio');
    expect(CitaEstadoCambiado.parse(con).data).toMatchObject({ pideCambio: true, origen: 'paciente' });
    expect(() => CitaEstadoCambiado.parse({ ...con, data: { ...con.data, origen: 'otro' } })).toThrow();
  });
  test('CitaCancelada acepta origen opcional y sigue siendo v1', () => {
    const data = { citaId: id, medicoId: id, inicio: inst, fin: inst };
    expect(CitaCancelada.version).toBe(1);
    expect(CitaCancelada.parse(CitaCancelada.create({ ...base, data })).data).toEqual(data);
    expect(CitaCancelada.parse(CitaCancelada.create({ ...base, data: { ...data, origen: 'recepcion' } })).data.origen).toBe('recepcion');
  });
});

describe('eventos de notificaciones', () => {
  test('CitaRespuestaPaciente valida respuesta, canal y origen', () => {
    const data = { citaId: id, inicioCita: '2030-01-07T11:00:00-06:00', respuesta: 'pide_cambio', canal: 'whatsapp_asistido', origen: 'recepcion' } as const;
    expect(CitaRespuestaPaciente.type).toBe('cita.respuesta_paciente');
    expect(CitaRespuestaPaciente.parse(CitaRespuestaPaciente.create({ ...base, data })).data).toEqual(data);
    expect(() => CitaRespuestaPaciente.parse({ ...CitaRespuestaPaciente.create({ ...base, data }), data: { ...data, canal: 'sms' } })).toThrow();
  });
  test('ConfigRecordatoriosActualizada lleva la lista de campos', () => {
    expect(ConfigRecordatoriosActualizada.type).toBe('config_recordatorios.actualizada');
    expect(ConfigRecordatoriosActualizada.parse(ConfigRecordatoriosActualizada.create({ ...base, data: { campos: ['modo'] } })).data.campos).toEqual(['modo']);
  });
});

describe('contratos de API internos', () => {
  test('citaParaRecordatorioSchema acepta email null y rechaza estados fuera de agendada/confirmada', () => {
    const cita = {
      citaId: id,
      version: 1,
      inicio: inst,
      fin: inst,
      estado: 'agendada',
      pideCambio: false,
      medicoId: id,
      medicoNombre: 'Dra. Ana',
      tipoCitaNombre: 'Consulta',
      contacto: { nombre: 'P', telefono: '5555555555', email: null },
    };
    expect(citaParaRecordatorioSchema.parse(cita)).toEqual(cita);
    expect(() => citaParaRecordatorioSchema.parse({ ...cita, estado: 'cancelada' })).toThrow();
  });
  test('consultorioParaMensajeSchema acepta personalización vacía', () => {
    const c = { nombreMostrado: 'X', telefono: null, colorPrimario: null, colorTexto: null, logoKey: null, zonaHoraria: 'America/Mexico_City', pais: 'MX' };
    expect(consultorioParaMensajeSchema.parse(c)).toEqual(c);
  });
});
