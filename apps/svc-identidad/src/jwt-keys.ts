import type { JWK } from 'jose';

/**
 * Deriva la llave pública (para el JWKS local) de la llave privada Ed25519 de firma.
 * Nunca copia `d`: solo `kty`, `crv`, `x` y, si existe, `kid`.
 */
export function publicJwkFrom(privada: JWK): JWK {
  if (privada.kty !== 'OKP' || privada.crv !== 'Ed25519' || typeof privada.x !== 'string' || typeof privada.d !== 'string') {
    throw new Error('JWT_PRIVATE_JWK debe ser una llave privada Ed25519 (kty OKP, crv Ed25519, con x y d)');
  }
  const pub: JWK = { kty: 'OKP', crv: 'Ed25519', x: privada.x, alg: 'EdDSA', use: 'sig' };
  if (privada.kid) pub.kid = privada.kid;
  return pub;
}
