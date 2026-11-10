import { exportJWK, generateKeyPair } from 'jose';
import { describe, expect, test } from 'vitest';
import { publicJwkFrom } from '../../src/jwt-keys.js';

describe('publicJwkFrom', () => {
  test('deriva la llave pública Ed25519 sin material privado', async () => {
    const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    const priv = { ...(await exportJWK(privateKey)), kid: 'k1' };
    const pub = publicJwkFrom(priv);
    expect(pub).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: 'k1', alg: 'EdDSA', use: 'sig', x: priv.x });
    expect(pub).not.toHaveProperty('d');
  });

  test('sin kid en la privada, la pública tampoco lo lleva', async () => {
    const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    expect(publicJwkFrom(await exportJWK(privateKey))).not.toHaveProperty('kid');
  });

  test.each([
    ['sin componente privado', { kty: 'OKP', crv: 'Ed25519', x: 'abc' }],
    ['curva distinta', { kty: 'OKP', crv: 'Ed448', x: 'abc', d: 'def' }],
    ['tipo distinto', { kty: 'RSA', n: 'a', e: 'b', d: 'c' }],
    ['sin x', { kty: 'OKP', crv: 'Ed25519', d: 'def' }],
  ])('rechaza una llave %s', (_n, jwk) => {
    expect(() => publicJwkFrom(jwk)).toThrow(/Ed25519/);
  });
});
