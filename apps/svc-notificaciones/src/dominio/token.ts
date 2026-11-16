import { createHash, randomBytes } from 'node:crypto';

export const hashDeToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** 32 bytes aleatorios en base64url (43 caracteres); solo el SHA-256 se guarda. */
export function generarToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashDeToken(token) };
}
