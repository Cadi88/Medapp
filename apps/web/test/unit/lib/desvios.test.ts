// @vitest-environment node
import type { ErrorCode } from '@consultorio/contracts';
import { expect, test } from 'vitest';
import { destinoPorError } from '@/lib/sesion/desvios';

test.each([
  ['PASSWORD_TEMPORAL', 403, '/cambiar-password'],
  ['MFA_REQUERIDA', 403, '/configurar-mfa'],
  ['NO_AUTENTICADO', 401, '/login'],
  ['PROHIBIDO', 403, '/sin-acceso'],
] as const)('destinoPorError(%s)', (code, status, destino) => expect(destinoPorError({ code, message: '' }, status)).toBe(destino));

test('cualquier 401 lleva a /login aunque el código no sea NO_AUTENTICADO', () => {
  expect(destinoPorError({ code: 'INTERNO', message: '' }, 401)).toBe('/login');
});

test.each<[ErrorCode, number]>([
  ['HORARIO_OCUPADO', 409],
  ['VALIDACION', 400],
  ['INTERNO', 503],
  ['NO_ENCONTRADO', 404],
])('%s (%i) no desvía: lo maneja la pantalla', (code, status) => {
  expect(destinoPorError({ code, message: '' }, status)).toBeNull();
});
