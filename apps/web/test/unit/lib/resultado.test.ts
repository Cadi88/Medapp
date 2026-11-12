// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { errorDeRespuesta, exito, fallo } from '@/lib/api/resultado';

describe('Resultado', () => {
  test('exito y fallo arman las dos ramas, con set-cookie solo si los hay', () => {
    expect(exito({ a: 1 })).toEqual({ ok: true, datos: { a: 1 } });
    expect(exito(1, ['x=1'])).toEqual({ ok: true, datos: 1, setCookies: ['x=1'] });
    expect(fallo(404, { code: 'NO_ENCONTRADO', message: 'No' })).toEqual({
      ok: false,
      status: 404,
      error: { code: 'NO_ENCONTRADO', message: 'No' },
    });
    expect(fallo(401, { code: 'NO_AUTENTICADO', message: '' }, ['x=; Max-Age=0'])).toMatchObject({ setCookies: ['x=; Max-Age=0'] });
  });

  test('errorDeRespuesta conserva un error con el formato único de la API', () => {
    const e = { code: 'CONFLICTO_VERSION', message: 'Alguien modificó la cita', details: { version: 3 } };
    expect(errorDeRespuesta(409, e)).toEqual(e);
  });

  test.each([
    [401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid' }, 'NO_AUTENTICADO'],
    [401, undefined, 'NO_AUTENTICADO'],
    [500, 'texto', 'INTERNO'],
    [429, { statusCode: 429 }, 'INTERNO'],
  ])('errorDeRespuesta(%i, %j) fuera de formato → %s sin detalles internos', (status, cuerpo, code) => {
    const e = errorDeRespuesta(status, cuerpo);
    expect(e.code).toBe(code);
    expect(e.details).toBeUndefined();
  });
});
