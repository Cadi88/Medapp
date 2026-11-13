const FORMATO = /^#[0-9a-f]{6}$/;

function luminancia(hex: string): number {
  const canal = (i: number): number => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

/** Relación de contraste WCAG 2.x entre dos colores `#rrggbb` (1 a 21). */
export function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Texto (blanco o negro) con mayor contraste sobre el fondo dado. */
export function colorDeTexto(fondo: string): '#ffffff' | '#000000' {
  return contraste(fondo, '#ffffff') >= contraste(fondo, '#000000') ? '#ffffff' : '#000000';
}

/** `#rrggbb` en minúsculas con contraste ≥ 3:1 contra blanco. */
export function colorValidoSobreBlanco(color: string): boolean {
  return FORMATO.test(color) && contraste(color, '#ffffff') >= 3;
}
