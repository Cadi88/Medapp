import { tokenClaimsSchema, type TokenClaims } from '@consultorio/contracts';
import { SignJWT, importJWK, type JWK } from 'jose';

/** Vigencia del token de tenant: 15 minutos. */
export const TOKEN_TTL_SEG = 900;

/**
 * Firma el token de tenant (EdDSA). Los claims se validan con `tokenClaimsSchema` antes de firmar
 * (y se descartan los que no pertenecen al contrato). `kid` coincide con el del JWKS publicado.
 */
export async function firmarTokenTenant(claims: TokenClaims, jwk: JWK, ahora: Date = new Date()): Promise<string> {
  const c = tokenClaimsSchema.parse(claims);
  const iat = Math.floor(ahora.getTime() / 1000);
  const key = await importJWK(jwk, 'EdDSA');
  return new SignJWT({ tid: c.tid, rol: c.rol, admin: c.admin, mfa: c.mfa })
    .setProtectedHeader({ alg: 'EdDSA', ...(jwk.kid ? { kid: jwk.kid } : {}) })
    .setSubject(c.sub)
    .setIssuer('svc-identidad')
    .setIssuedAt(iat)
    .setExpirationTime(iat + TOKEN_TTL_SEG)
    .sign(key);
}
