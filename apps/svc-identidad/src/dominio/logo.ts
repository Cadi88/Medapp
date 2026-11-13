export type FormatoLogo = 'png' | 'jpeg' | 'webp';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const empieza = (b: Uint8Array, firma: number[], desde = 0): boolean => b.length >= desde + firma.length && firma.every((x, i) => b[desde + i] === x);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Formato real según los primeros bytes (nunca el content-type ni la extensión). `null` = no admitido. */
export function detectarFormato(bytes: Uint8Array): FormatoLogo | null {
  if (empieza(bytes, PNG)) return 'png';
  if (empieza(bytes, JPEG)) return 'jpeg';
  if (empieza(bytes, ascii('RIFF')) && empieza(bytes, ascii('WEBP'), 8)) return 'webp';
  return null;
}
