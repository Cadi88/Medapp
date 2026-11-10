import { describe, expect, test } from 'vitest';
import { isPublicPath, pathOf, sanitizeTraceId } from '../../src/http/public-routes.js';

describe('pathOf', () => {
  test('quita query y fragmento', () => {
    expect(pathOf('/a/b?x=1')).toBe('/a/b');
    expect(pathOf('/a#f')).toBe('/a');
    expect(pathOf('/a')).toBe('/a');
  });
});

describe('isPublicPath', () => {
  const pub = ['/publica', '/auth/*'];
  test.each([
    ['/publica', true],
    ['/publica?x=1', true],
    ['/publica/', false],
    ['/publicax', false],
    ['/Publica', false],
    ['/auth/sign-in', true],
    ['/auth/x/y', true],
    ['/auth/sign-in?next=/privada', true],
    ['/authx', false],
    ['/auth', false],
    ['/auth/', false],
    ['/privada', false],
    ['/', false],
    ['', false],
    ['publica', false],
  ])('%s → %s', (url, esperado) => {
    expect(isPublicPath(url, pub)).toBe(esperado);
  });

  test.each([
    '/auth/../privada',
    '/auth/./x',
    '/auth/%2e%2e/privada',
    '/auth/%2E%2E/privada',
    '/auth/..%2fprivada',
    '/auth/x%5cy',
    '/auth\\x',
    '/auth//x',
    '/publica/..',
  ])('path-traversal %s nunca es público', (url) => {
    expect(isPublicPath(url, pub)).toBe(false);
  });

  test('sin rutas públicas nada es público', () => {
    expect(isPublicPath('/publica', [])).toBe(false);
  });
});

describe('sanitizeTraceId', () => {
  test('acepta ids válidos', () => {
    expect(sanitizeTraceId('abc-123')).toBe('abc-123');
    expect(sanitizeTraceId('a'.repeat(64))).toBe('a'.repeat(64));
  });
  test.each(['', 'a'.repeat(65), 'a b', 'a\nb', '<script>', 'é', undefined, 5, ['a']])('reemplaza %j', (v) => {
    expect(sanitizeTraceId(v)).toMatch(/^[a-f0-9]{32}$/);
  });
  test('genera ids distintos', () => {
    expect(sanitizeTraceId(undefined)).not.toBe(sanitizeTraceId(undefined));
  });
});
