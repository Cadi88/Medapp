/** JWT sin firma válida: el sitio solo decodifica `exp` y los claims; la verificación la hacen gateway y servicios. */
export function jwtFalso(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64(payload)}.firma`;
}

export const CLAIMS = {
  sub: '0192f0a0-0000-7000-8000-000000000001',
  tid: '0192f0a0-0000-7000-8000-000000000002',
  rol: 'medico',
  admin: true,
  mfa: true,
} as const;

/** Token cuyo `exp` queda `segundos` después de `ahora`. */
export function tokenQueVence(ahora: Date, segundos: number): string {
  return jwtFalso({ ...CLAIMS, iss: 'svc-identidad', exp: Math.floor(ahora.getTime() / 1000) + segundos });
}
