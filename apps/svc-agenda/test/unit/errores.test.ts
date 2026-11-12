import { AppError } from '@consultorio/platform';
import { describe, expect, test } from 'vitest';
import { esViolacionExclusion, esViolacionUnica, traducirErrorPg } from '../../src/datos/errores.js';

describe('traducirErrorPg', () => {
  test('23P01 sobre cita_sin_traslape → 409 HORARIO_OCUPADO', () => {
    const e = traducirErrorPg({ code: '23P01', constraint: 'cita_sin_traslape' });
    expect(e).toBeInstanceOf(AppError);
    expect(e).toMatchObject({ code: 'HORARIO_OCUPADO', status: 409 });
  });

  test('otra exclusión, otro código o un valor que no es error → null', () => {
    expect(traducirErrorPg({ code: '23P01', constraint: 'horario_excl' })).toBeNull();
    expect(traducirErrorPg({ code: '23505', constraint: 'cita_sin_traslape' })).toBeNull();
    expect(traducirErrorPg(new Error('x'))).toBeNull();
    expect(traducirErrorPg(null)).toBeNull();
    expect(traducirErrorPg('23P01')).toBeNull();
  });

  test('clasificadores por SQLSTATE', () => {
    expect(esViolacionUnica({ code: '23505' })).toBe(true);
    expect(esViolacionUnica({ code: '23P01' })).toBe(false);
    expect(esViolacionExclusion({ code: '23P01' })).toBe(true);
    expect(esViolacionExclusion(undefined)).toBe(false);
  });
});
