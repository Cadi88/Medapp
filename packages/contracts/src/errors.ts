import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'NO_AUTENTICADO',
  'PROHIBIDO',
  'MFA_REQUERIDA',
  'VALIDACION',
  'CONFLICTO',
  'NO_ENCONTRADO',
  'PASSWORD_TEMPORAL',
  'FUERA_DE_HORARIO',
  'HORARIO_OCUPADO',
  'HORARIO_BLOQUEADO',
  'CONFLICTO_VERSION',
  'INTERNO',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
