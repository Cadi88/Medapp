import { colorValidoSobreBlanco, normalizarTelefono, type CodigoPais, type Personalizacion } from '@consultorio/contracts';

export interface ValoresPersonalizacion {
  nombreComercial: string | null;
  direccion: string | null;
  telefono: string | null;
  colorPrimario: string | null;
}

export type CampoPersonalizacion = keyof ValoresPersonalizacion;

export type ResultadoPersonalizacion =
  | { ok: true; nuevos: ValoresPersonalizacion; cambiados: CampoPersonalizacion[] }
  | { ok: false; campo: 'telefono' | 'colorPrimario'; mensaje: string };

const CAMPOS: CampoPersonalizacion[] = ['nombreComercial', 'direccion', 'telefono', 'colorPrimario'];
const vacioANull = (v: string | null): string | null => (v === null || v === '' ? null : v);

/**
 * Aplica el cambio pedido sobre los valores actuales: normaliza el teléfono a E.164 según el país,
 * valida el color (minúsculas, contraste ≥ 3:1 sobre blanco) y devuelve solo los campos que realmente cambian.
 */
export function resolverPersonalizacion(entrada: Personalizacion, pais: CodigoPais, actual: ValoresPersonalizacion): ResultadoPersonalizacion {
  const nuevos: ValoresPersonalizacion = { ...actual };
  for (const campo of CAMPOS) {
    const v = entrada[campo];
    if (v === undefined) continue;
    nuevos[campo] = vacioANull(v);
  }
  if (entrada.telefono && nuevos.telefono !== null) {
    const e164 = normalizarTelefono(nuevos.telefono, pais);
    if (e164 === null) return { ok: false, campo: 'telefono', mensaje: 'Teléfono inválido' };
    nuevos.telefono = e164;
  }
  if (entrada.colorPrimario && nuevos.colorPrimario !== null) {
    nuevos.colorPrimario = nuevos.colorPrimario.toLowerCase();
    if (!colorValidoSobreBlanco(nuevos.colorPrimario)) return { ok: false, campo: 'colorPrimario', mensaje: 'Elige un color más oscuro' };
  }
  return { ok: true, nuevos, cambiados: CAMPOS.filter((c) => nuevos[c] !== actual[c]) };
}
