import { tokenClaimsSchema, type TokenClaims } from '@consultorio/contracts';

/** Margen para renovar: si al JWT le queda menos que esto, el proxy pide uno nuevo. */
const MARGEN_RENOVACION_MS = 60_000;

/** Payload del JWT SIN verificar la firma: solo sirve para decidir en el sitio; la autorización la hacen gateway y servicios. */
function payloadSinVerificar(token: string): unknown {
  const partes = token.split('.');
  if (partes.length !== 3 || !partes[1]) throw new Error('Token con formato inválido');
  return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
}

/** `true` si no hay token, es ilegible o le quedan menos de 60 s. */
export function necesitaRenovar(token: string | undefined, ahora: Date): boolean {
  if (!token) return true;
  let exp: unknown;
  try {
    exp = (payloadSinVerificar(token) as { exp?: unknown } | null)?.exp;
  } catch {
    return true;
  }
  if (typeof exp !== 'number') return true;
  return exp * 1000 - ahora.getTime() < MARGEN_RENOVACION_MS;
}

/** Claims del tenant para la interfaz (qué mostrar según rol y admin). Lanza si no cumplen el contrato. */
export function claimsDelToken(token: string): TokenClaims {
  return tokenClaimsSchema.parse(payloadSinVerificar(token));
}
