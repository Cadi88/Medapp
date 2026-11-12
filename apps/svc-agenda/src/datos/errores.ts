const codigo = (err: unknown): unknown => (typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined);

/** Violación de UNIQUE (SQLSTATE 23505). */
export const esViolacionUnica = (err: unknown): boolean => codigo(err) === '23505';

/** Violación de EXCLUDE (SQLSTATE 23P01). */
export const esViolacionExclusion = (err: unknown): boolean => codigo(err) === '23P01';
