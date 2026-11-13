import { REGLAS_BO } from './bo.js';
import { REGLAS_MX } from './mx.js';
import type { CodigoPais, ReglasPais } from './tipos.js';

export * from './tipos.js';

/** Países en los que se puede registrar un consultorio hoy. */
export const PAISES_HABILITADOS: readonly CodigoPais[] = ['MX'];

const REGLAS: Record<CodigoPais, ReglasPais> = { MX: REGLAS_MX, BO: REGLAS_BO };

export const reglasDe = (pais: CodigoPais): ReglasPais => REGLAS[pais];

/**
 * Devuelve el teléfono en E.164 o `null` si no es válido para el país. Quita espacios, guiones,
 * paréntesis y puntos; acepta solo dígitos nacionales o prefijo + dígitos (y en México el `+521` antiguo).
 */
export function normalizarTelefono(entrada: string, pais: CodigoPais): string | null {
  const { prefijoTelefonico, digitosNacionales } = reglasDe(pais);
  const limpio = entrada.replace(/[\s\-().]/g, '');
  let nacional: string;
  if (limpio.startsWith('+')) {
    const sinPrefijo = limpio.startsWith(prefijoTelefonico) ? limpio.slice(prefijoTelefonico.length) : null;
    if (sinPrefijo === null) return null;
    nacional = pais === 'MX' && sinPrefijo.length === digitosNacionales + 1 && sinPrefijo.startsWith('1') ? sinPrefijo.slice(1) : sinPrefijo;
  } else {
    nacional = limpio;
  }
  return nacional.length === digitosNacionales && /^[0-9]+$/.test(nacional) ? `${prefijoTelefonico}${nacional}` : null;
}
