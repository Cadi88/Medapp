import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export interface SignOptions {
  expiresIn?: string;
  /** Firma con una llave que NO está en el JWKS (mismo kid, para ejercitar la verificación de firma). */
  otraLlave?: boolean;
  issuer?: string;
}

export interface TestJwks {
  url: string;
  sign(claims: object, o?: SignOptions): Promise<string>;
  stop(): Promise<void>;
}

const KID = 'test-key';

/** Servidor JWKS local (puerto efímero) con una llave Ed25519 y un firmador de tokens EdDSA. */
export async function startTestJwks(): Promise<TestJwks> {
  const good = await generateKeyPair('EdDSA', { extractable: true });
  const other = await generateKeyPair('EdDSA');
  const jwk = { ...(await exportJWK(good.publicKey)), kid: KID, alg: 'EdDSA', use: 'sig' };
  const server: Server = createServer((req, res) => {
    if (req.url === '/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/.well-known/jwks.json`,
    async sign(claims, o = {}) {
      return new SignJWT({ ...claims })
        .setProtectedHeader({ alg: 'EdDSA', kid: KID })
        .setIssuer(o.issuer ?? 'svc-identidad')
        .setIssuedAt()
        .setExpirationTime(o.expiresIn ?? '15m')
        .sign(o.otraLlave ? other.privateKey : good.privateKey);
    },
    stop: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}
