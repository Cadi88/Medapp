import { describe, expect, test } from 'vitest';
import { isUniqueViolation } from '../../src/db/errors.js';

describe('isUniqueViolation', () => {
  test.each([
    [{ code: '23505' }, true],
    [Object.assign(new Error('x'), { code: '23505' }), true],
    [{ code: '23503' }, false],
    [new Error('x'), false],
    [null, false],
    ['23505', false],
    [undefined, false],
  ])('%j → %s', (e, esperado) => {
    expect(isUniqueViolation(e)).toBe(esperado);
  });
});
