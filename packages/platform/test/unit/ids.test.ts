import { describe, expect, test } from 'vitest';
import { uuidv7 } from '../../src/index.js';

describe('uuidv7', () => {
  test('tiene formato UUID versión 7', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  test('es único y creciente', () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
  });
});
