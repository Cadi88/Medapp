import { z } from 'zod';

export const rolSchema = z.enum(['medico', 'recepcion']);
export type Rol = z.infer<typeof rolSchema>;

export const tokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  tid: z.string().uuid(),
  rol: rolSchema,
  admin: z.boolean(),
  mfa: z.boolean(),
});
export type TokenClaims = z.infer<typeof tokenClaimsSchema>;
