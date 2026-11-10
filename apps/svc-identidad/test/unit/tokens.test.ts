import { createLocalJWKSet, decodeProtectedHeader, exportJWK, generateKeyPair, jwtVerify, type JWK } from 'jose';
import { beforeAll, describe, expect, test } from 'vitest';
import { publicJwkFrom } from '../../src/jwt-keys.js';
import { TOKEN_TTL_SEG, firmarTokenTenant } from '../../src/tokens.js';

const claims = {
  sub: '0190aaaa-0000-7000-8000-000000000001',
  tid: '0190aaaa-0000-7000-8000-000000000002',
  rol: 'admin',
  mfa: true,
} as const;

let privada: JWK;
beforeAll(async () => {
  const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
  privada = { ...(await exportJWK(privateKey)), kid: 'k1' };
});

describe('firmarTokenTenant', () => {
  test('firma EdDSA con kid, issuer svc-identidad, claims y exp = iat + 900', async () => {
    const token = await firmarTokenTenant(claims, privada);
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: 'EdDSA', kid: 'k1' });
    const jwks = createLocalJWKSet({ keys: [publicJwkFrom(privada)] });
    const { payload } = await jwtVerify(token, jwks, { issuer: 'svc-identidad', algorithms: ['EdDSA'] });
    expect(payload).toMatchObject(claims);
    expect(payload.exp! - payload.iat!).toBe(900);
    expect(TOKEN_TTL_SEG).toBe(900);
  });

  test('iat se toma del reloj inyectado y el token expira a los 15 minutos', async () => {
    const ahora = new Date('2026-01-01T00:00:00Z');
    const token = await firmarTokenTenant(claims, privada, ahora);
    const jwks = createLocalJWKSet({ keys: [publicJwkFrom(privada)] });
    const t0 = Math.floor(ahora.getTime() / 1000);
    const { payload } = await jwtVerify(token, jwks, { issuer: 'svc-identidad', currentDate: new Date((t0 + 899) * 1000) });
    expect(payload.iat).toBe(t0);
    expect(payload.exp).toBe(t0 + 900);
    await expect(jwtVerify(token, jwks, { issuer: 'svc-identidad', currentDate: new Date((t0 + 901) * 1000) })).rejects.toThrow(/exp/);
  });

  test('un token firmado con otra llave no verifica', async () => {
    const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    const otra = { ...(await exportJWK(privateKey)), kid: 'k1' };
    const token = await firmarTokenTenant(claims, otra);
    const jwks = createLocalJWKSet({ keys: [publicJwkFrom(privada)] });
    await expect(jwtVerify(token, jwks, { issuer: 'svc-identidad' })).rejects.toThrow();
  });

  test('sin kid en la llave el encabezado no lo lleva', async () => {
    const sinKid: JWK = { ...privada };
    delete sinKid.kid;
    const token = await firmarTokenTenant(claims, sinKid);
    expect(decodeProtectedHeader(token).kid).toBeUndefined();
  });

  test('claims invalidos (sub no UUID, rol desconocido, mfa ausente) no se firman', async () => {
    await expect(firmarTokenTenant({ ...claims, sub: 'x' }, privada)).rejects.toThrow();
    await expect(firmarTokenTenant({ ...claims, rol: 'root' } as never, privada)).rejects.toThrow();
    await expect(firmarTokenTenant({ sub: claims.sub, tid: claims.tid, rol: 'admin' } as never, privada)).rejects.toThrow();
  });

  test('claims extra no se cuelan al token', async () => {
    const token = await firmarTokenTenant({ ...claims, extra: 'x' } as never, privada);
    const jwks = createLocalJWKSet({ keys: [publicJwkFrom(privada)] });
    const { payload } = await jwtVerify(token, jwks, { issuer: 'svc-identidad' });
    expect(payload).not.toHaveProperty('extra');
  });
});
