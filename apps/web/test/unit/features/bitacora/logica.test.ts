import { describe, expect, test } from 'vitest';
import { ACCIONES_CONOCIDAS, detalleDeAccion, etiquetaAccion } from '@/features/bitacora/logica/acciones';
import { consultaDesdeParametros, nombreDelActor } from '@/features/bitacora/logica/filtros';

describe('etiquetaAccion', () => {
  test('cubre todas las acciones conocidas con texto legible', () => {
    expect(etiquetaAccion('cita.creada')).toBe('Cita creada');
    expect(ACCIONES_CONOCIDAS.map((a) => [a, etiquetaAccion(a)])).toEqual([
      ['tenant.creado', 'Consultorio creado'],
      ['usuario.vinculado', 'Persona agregada al equipo'],
      ['usuario.desvinculado', 'Persona quitada del equipo'],
      ['miembro.actualizado', 'Miembro actualizado'],
      ['medico.actualizado', 'Perfil médico actualizado'],
      ['cita.creada', 'Cita creada'],
      ['cita.reprogramada', 'Cita reprogramada'],
      ['cita.cancelada', 'Cita cancelada'],
      ['cita.estado_cambiado', 'Estado de cita cambiado'],
      ['cita.respuesta_paciente', 'Respuesta del paciente recibida'],
      ['consultorio.actualizado', 'Consultorio actualizado'],
      ['config_recordatorios.actualizada', 'Recordatorios configurados'],
    ]);
  });

  test('una acción desconocida se muestra tal cual', () => {
    expect(etiquetaAccion('receta.emitida')).toBe('receta.emitida');
  });
});

describe('consultaDesdeParametros', () => {
  const ZONA = 'America/Mexico_City';

  test('las fechas se toman como días completos en la zona del consultorio', () => {
    const q = consultaDesdeParametros({ desde: '2026-11-12', hasta: '2026-11-13', accion: 'cita.creada' }, ZONA);
    expect(q).toEqual({
      desde: '2026-11-12T06:00:00.000Z',
      hasta: '2026-11-14T05:59:59.999Z',
      accion: 'cita.creada',
    });
  });

  test('ignora valores vacíos o inválidos y toma el primero si llegan repetidos', () => {
    expect(consultaDesdeParametros({ desde: '', hasta: 'ayer', accion: 'DROP TABLE' }, ZONA)).toEqual({});
    expect(consultaDesdeParametros({ desde: ['2026-11-12', '2026-11-01'] }, ZONA)).toEqual({ desde: '2026-11-12T06:00:00.000Z' });
  });

  test('si desde es posterior a hasta, descarta hasta', () => {
    expect(consultaDesdeParametros({ desde: '2026-11-13', hasta: '2026-11-12' }, ZONA)).toEqual({ desde: '2026-11-13T06:00:00.000Z' });
  });
});

describe('nombreDelActor', () => {
  const nombres = { a1: 'Dra. Ruiz' };
  test('resuelve el nombre; sin actor es "Sistema"; un actor que ya no es miembro es "Exmiembro" con su id corto', () => {
    expect(nombreDelActor('a1', nombres)).toBe('Dra. Ruiz');
    expect(nombreDelActor(null, nombres)).toBe('Sistema');
    expect(nombreDelActor('01a1cd34-0000-7000-8000-000000000001', nombres)).toBe('Exmiembro (01a1cd34)');
  });
});

describe('detalleDeAccion', () => {
  test('consultorio.actualizado lista los campos en español', () => {
    expect(
      detalleDeAccion('consultorio.actualizado', {
        campos: ['logo', 'colorPrimario', 'nombreComercial', 'direccion', 'telefono'],
      }),
    ).toBe('Logo, Color, Nombre comercial, Dirección, Teléfono');
  });

  test('sin detalle útil o de otra acción no hay texto; un campo desconocido se omite', () => {
    expect(detalleDeAccion('consultorio.actualizado', null)).toBeUndefined();
    expect(detalleDeAccion('consultorio.actualizado', { campos: 'x' })).toBeUndefined();
    expect(detalleDeAccion('consultorio.actualizado', { campos: ['nuevo'] })).toBeUndefined();
    expect(detalleDeAccion('consultorio.actualizado', { campos: ['logo', 'nuevo'] })).toBe('Logo');
    expect(detalleDeAccion('cita.creada', { campos: ['logo'] })).toBeUndefined();
  });
});

describe('cita.respuesta_paciente', () => {
  test('dice qué respondió el paciente', () => {
    expect(etiquetaAccion('cita.respuesta_paciente', { respuesta: 'confirma', origen: 'paciente' })).toBe('Respuesta del paciente recibida: confirma');
    expect(etiquetaAccion('cita.respuesta_paciente', { respuesta: 'cancela', origen: 'paciente' })).toBe('Respuesta del paciente recibida: cancela');
    expect(etiquetaAccion('cita.respuesta_paciente', { respuesta: 'pide_cambio', origen: 'paciente' })).toBe('Respuesta del paciente recibida: pide cambio');
  });

  test('registrada por recepción lo dice', () => {
    expect(etiquetaAccion('cita.respuesta_paciente', { respuesta: 'confirma', origen: 'recepcion' })).toBe('Respuesta del paciente recibida: confirma (registrado por recepción)');
  });

  test('sin detalle (o con una respuesta que esta versión no conoce) queda el texto general', () => {
    expect(etiquetaAccion('cita.respuesta_paciente')).toBe('Respuesta del paciente recibida');
    expect(etiquetaAccion('cita.respuesta_paciente', { respuesta: 'quizas', origen: 'paciente' })).toBe('Respuesta del paciente recibida');
    expect(etiquetaAccion('cita.respuesta_paciente', { origen: 'recepcion' })).toBe('Respuesta del paciente recibida (registrado por recepción)');
  });
});

describe('etiquetas de la respuesta del paciente (con su origen)', () => {
  test('cita.cancelada con origen paciente → "Cita cancelada por el paciente"', () => {
    expect(etiquetaAccion('cita.cancelada', { origen: 'paciente' })).toBe('Cita cancelada por el paciente');
  });

  test('registrado por recepción lo dice', () => {
    expect(etiquetaAccion('cita.cancelada', { origen: 'recepcion' })).toBe('Cita cancelada por el paciente (registrado por recepción)');
    expect(etiquetaAccion('cita.estado_cambiado', { origen: 'recepcion', pideCambio: true })).toBe('Paciente pide cambio (registrado por recepción)');
  });

  test('cita.estado_cambiado a confirmada con origen paciente → "Cita confirmada por el paciente"', () => {
    expect(etiquetaAccion('cita.estado_cambiado', { origen: 'paciente', a: 'confirmada' })).toBe('Cita confirmada por el paciente');
  });

  test('cita.estado_cambiado con pideCambio y origen paciente → "Paciente pide cambio"', () => {
    expect(etiquetaAccion('cita.estado_cambiado', { origen: 'paciente', pideCambio: true })).toBe('Paciente pide cambio');
  });

  test('las acciones del personal y los eventos viejos (sin origen) conservan su texto', () => {
    expect(etiquetaAccion('cita.cancelada', { origen: 'personal' })).toBe('Cita cancelada');
    expect(etiquetaAccion('cita.cancelada', {})).toBe('Cita cancelada');
    expect(etiquetaAccion('cita.cancelada', null)).toBe('Cita cancelada');
    expect(etiquetaAccion('cita.estado_cambiado', { origen: 'personal', a: 'confirmada' })).toBe('Estado de cita cambiado');
    expect(etiquetaAccion('cita.creada', { origen: 'paciente' })).toBe('Cita creada');
  });
});
