import { describe, expect, test } from 'vitest';
import { z, ZodError } from 'zod';
import { AppError, mapError } from '../../src/http/errors.js';

describe('mapError', () => {
  test('AppError conserva status, código, mensaje y detalles', () => {
    const r = mapError(new AppError('CONFLICTO', 'ya existe', 409, { slug: 'x' }));
    expect(r).toEqual({
      status: 409,
      body: { code: 'CONFLICTO', message: 'ya existe', details: { slug: 'x' } },
      unexpected: false,
    });
  });
  test('AppError sin detalles no incluye la clave details', () => {
    const r = mapError(new AppError('PROHIBIDO', 'no', 403));
    expect('details' in r.body).toBe(false);
  });
  test('ZodError → 400 VALIDACION solo con rutas', () => {
    const res = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: { b: 5 } });
    const r = mapError((res as { error: ZodError }).error);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ code: 'VALIDACION', message: 'Solicitud inválida', details: [{ campo: 'a.b' }] });
  });
  test('error de validación de Fastify → 400 con rutas de campo', () => {
    const err = Object.assign(new Error('body/x must be string'), {
      validation: [
        { instancePath: '/x/y', params: {} },
        { instancePath: '', params: { missingProperty: 'z' } },
        { instancePath: '/w', params: { missingProperty: 'q' } },
        {},
      ],
    });
    const r = mapError(err);
    expect(r.status).toBe(400);
    expect(r.body.details).toEqual([{ campo: 'x.y' }, { campo: 'z' }, { campo: 'w.q' }, { campo: '' }]);
    expect(JSON.stringify(r.body)).not.toContain('must be');
  });
  test('error 4xx propio de Fastify conserva su status', () => {
    const r = mapError(
      Object.assign(new Error('Unexpected token'), { code: 'FST_ERR_CTP_INVALID_JSON_BODY', statusCode: 400 }),
    );
    expect(r).toMatchObject({ status: 400, body: { code: 'VALIDACION', message: 'Solicitud inválida' }, unexpected: false });
    expect(
      mapError(Object.assign(new Error('x'), { code: 'FST_ERR_CTP_BODY_TOO_LARGE', statusCode: 413 })).status,
    ).toBe(413);
  });
  test.each([
    new Error('select * from secretos'),
    Object.assign(new Error('x'), { statusCode: 400 }),
    Object.assign(new Error('x'), { code: 'FST_ERR_X', statusCode: 500 }),
    'cadena',
    null,
    undefined,
  ])('todo lo demás → 500 INTERNO genérico (%#)', (e) => {
    expect(mapError(e)).toEqual({
      status: 500,
      body: { code: 'INTERNO', message: 'Error interno' },
      unexpected: true,
    });
  });
});
