import { describe, expect, test } from 'vitest';
import {
  actualizarConfigRecordatoriosSchema,
  aprobarRangoSchema,
  configRecordatoriosSchema,
  rangoRecordatoriosSchema,
  recordatorioCitaSchema,
  registrarRespuestaPacienteSchema,
  registrarRespuestaRecepcionSchema,
  respuestaPublicaSchema,
} from '../../src/index.js';

const cita = {
  citaId: '0198f2a0-0000-7000-8000-000000000001',
  fecha: '2030-01-08',
  inicio: '2030-01-08T15:00:00.000Z',
  paciente: 'Ana',
  medico: 'Dra. Ruiz',
  estadoCita: 'agendada',
  pideCambio: false,
  correo: { estado: 'pendiente', sinAprobarYVencido: false, vistaPrevia: { asunto: 'a', texto: 't' } },
  whatsapp: { abierto: false, enlace: 'https://wa.me/525512345678?text=x', motivo: null, vistaPrevia: 'hola' },
  respuesta: null,
};

describe('api de notificaciones', () => {
  test('rango: fechas YYYY-MM-DD', () => {
    expect(rangoRecordatoriosSchema.parse({ desde: '2030-01-01', hasta: '2030-01-07' })).toEqual({ desde: '2030-01-01', hasta: '2030-01-07' });
    expect(() => rangoRecordatoriosSchema.parse({ desde: '01/01/2030', hasta: '2030-01-07' })).toThrow();
    expect(aprobarRangoSchema.parse({ desde: '2030-01-01', hasta: '2030-01-02' })).toBeTruthy();
  });

  test('recordatorio de cita: estados de correo y motivo de WhatsApp acotados', () => {
    expect(recordatorioCitaSchema.parse(cita)).toEqual(cita);
    expect(() => recordatorioCitaSchema.parse({ ...cita, correo: { ...cita.correo, estado: 'otro' } })).toThrow();
    expect(() => recordatorioCitaSchema.parse({ ...cita, whatsapp: { ...cita.whatsapp, motivo: 'raro' } })).toThrow();
    const conRespuesta = { ...cita, respuesta: { valor: 'confirma', canal: 'correo', origen: 'paciente', respondidoEn: '2030-01-07T16:00:00.000Z' } };
    expect(recordatorioCitaSchema.parse(conRespuesta).respuesta?.valor).toBe('confirma');
  });

  test('respuestas: solo confirma, cancela o pide_cambio', () => {
    expect(registrarRespuestaPacienteSchema.parse({ respuesta: 'cancela' })).toEqual({ respuesta: 'cancela' });
    expect(() => registrarRespuestaPacienteSchema.parse({ respuesta: 'quizá' })).toThrow();
    expect(registrarRespuestaRecepcionSchema.parse({ fecha: '2030-01-08', respuesta: 'pide_cambio' })).toEqual({ fecha: '2030-01-08', respuesta: 'pide_cambio' });
    expect(() => registrarRespuestaRecepcionSchema.parse({ respuesta: 'confirma' })).toThrow();
  });

  test('config: hora HH:mm y modo acotado; el PUT admite cambios parciales', () => {
    const plantillas = { correoAsunto: 'a', correoCuerpo: 'c', whatsapp: 'w' };
    expect(configRecordatoriosSchema.parse({ modo: 'con_revision', horaEnvio: '10:00', plantillas })).toBeTruthy();
    expect(() => configRecordatoriosSchema.parse({ modo: 'con_revision', horaEnvio: '25:00', plantillas })).toThrow();
    expect(actualizarConfigRecordatoriosSchema.parse({ horaEnvio: '09:30' })).toEqual({ horaEnvio: '09:30' });
    expect(actualizarConfigRecordatoriosSchema.parse({ plantillas: { whatsapp: 'x' } })).toEqual({ plantillas: { whatsapp: 'x' } });
    expect(() => actualizarConfigRecordatoriosSchema.parse({ modo: 'raro' })).toThrow();
    expect(() => actualizarConfigRecordatoriosSchema.parse({ otro: 1 })).toThrow();
  });

  test('respuesta pública: los datos solo acompañan a un enlace vigente o respondido', () => {
    expect(respuestaPublicaSchema.parse({ estado: 'invalida' })).toEqual({ estado: 'invalida' });
    expect(respuestaPublicaSchema.parse({ estado: 'vigente', consultorio: { nombre: 'C', tieneLogo: false }, fecha: 'lunes 7 de enero', hora: '09:00', medico: 'M', telefonoConsultorio: '5512345678' }).estado).toBe('vigente');
    expect(() => respuestaPublicaSchema.parse({ estado: 'desconocida' })).toThrow();
  });
});

describe('respuestas de las acciones de recordatorios', () => {
  const id = '0190a0a0-0000-7000-8000-0000000000a1';
  test('forma de cada respuesta', async () => {
    const c = await import('../../src/api/notificaciones.js');
    expect(c.estadoCorreoRespuestaSchema.parse({ citaId: id, estado: 'enviado' })).toEqual({ citaId: id, estado: 'enviado' });
    expect(c.estadoCorreoRespuestaSchema.safeParse({ citaId: id, estado: 'raro' }).success).toBe(false);
    expect(c.aprobarRangoRespuestaSchema.parse({ aprobados: 2, enviados: 1 })).toEqual({ aprobados: 2, enviados: 1 });
    expect(c.enlaceWhatsAppSchema.parse({ enlace: 'https://wa.me/1' })).toEqual({ enlace: 'https://wa.me/1' });
    expect(c.respuestaRegistradaSchema.parse({ citaId: id, respuesta: 'cancela' })).toEqual({ citaId: id, respuesta: 'cancela' });
  });
});
