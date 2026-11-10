import { uuidv7 as generate } from 'uuidv7';

/** Identificador UUIDv7 (ordenable por tiempo) en formato canónico. */
export function uuidv7(): string {
  return generate();
}
