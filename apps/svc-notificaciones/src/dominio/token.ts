import { createHash, randomBytes } from 'node:crypto';

export const hashDeToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** 32 bytes aleatorios en base64url (43 caracteres); solo el SHA-256 se guarda. */
export function generarToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashDeToken(token) };
}

/** Un token válido tiene exactamente la forma que genera `generarToken` (43 caracteres base64url); cualquier otra cosa ni se busca. */
export const tieneFormatoDeToken = (token: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(token);
