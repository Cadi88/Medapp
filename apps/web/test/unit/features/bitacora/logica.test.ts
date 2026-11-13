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
      ['consultorio.actualizado', 'Consultorio actualizado'],
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
