import { normalizarTelefono, type CodigoPais } from '@consultorio/contracts';

/** Enlace `wa.me` con el mensaje; `null` si el teléfono no se puede normalizar para el país. */
export function enlaceWhatsApp(telefono: string, pais: CodigoPais, mensaje: string): string | null {
  const e164 = normalizarTelefono(telefono, pais);
  if (e164 === null) return null;
  return `https://wa.me/${e164.replace(/^\+/, '')}?text=${encodeURIComponent(mensaje)}`;
}
