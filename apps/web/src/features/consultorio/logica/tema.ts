import type { Consultorio } from '@consultorio/contracts';

/**
 * Colores sugeridos para el consultorio: todos pasan la regla de contraste (≥ 3:1 sobre blanco),
 * así que el texto de los botones siempre se lee bien.
 */
export const PALETA: readonly string[] = [
  '#1d4ed8',
  '#0f766e',
  '#15803d',
  '#b45309',
  '#b91c1c',
  '#7e22ce',
  '#be185d',
  '#334155',
];

/**
 * Variables CSS que los componentes de shadcn ya usan (`bg-primary`, `text-primary-foreground`).
 * Sin color del consultorio no se fija nada y rige el tema por omisión.
 */
export function variablesDeTema(c: Pick<Consultorio, 'colorPrimario' | 'colorTexto'>): Record<string, string> {
  if (!c.colorPrimario || !c.colorTexto) return {};
  return { '--primary': c.colorPrimario, '--primary-foreground': c.colorTexto };
}
