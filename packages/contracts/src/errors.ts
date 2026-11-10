import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'NO_AUTENTICADO',
  'PROHIBIDO',
  'MFA_REQUERIDA',
  'VALIDACION',
  'CONFLICTO',
  'NO_ENCONTRADO',
  'INTERNO',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
