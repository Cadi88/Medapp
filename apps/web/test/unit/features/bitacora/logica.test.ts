import { describe, expect, test } from 'vitest';
import { ACCIONES_CONOCIDAS, etiquetaAccion } from '@/features/bitacora/logica/acciones';
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
  test('resuelve el nombre; sin actor o desconocido es "Sistema"', () => {
    expect(nombreDelActor('a1', nombres)).toBe('Dra. Ruiz');
    expect(nombreDelActor(null, nombres)).toBe('Sistema');
    expect(nombreDelActor('otro', nombres)).toBe('Sistema');
  });
});
