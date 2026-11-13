'use client';

import { Button } from '@/components/ui/button';
import { errorDeColor } from '../logica/formulario';
import { PALETA } from '../logica/tema';

interface Props {
  /** `#rrggbb` o vacío (color por omisión). */
  valor: string;
  onCambio: (color: string) => void;
  /** Error del servidor para este campo. */
  error?: string | undefined;
}

/** Paleta de colores sugeridos y selector libre. El color elegido viaja en el campo `colorPrimario`. */
export function SelectorColor({ valor, onCambio, error }: Props) {
  const aviso = errorDeColor(valor) ?? error;
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Color del consultorio</span>
      <input type="hidden" name="colorPrimario" value={valor} />
      <div className="flex flex-wrap items-center gap-2">
        {PALETA.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={valor === c}
            onClick={() => onCambio(c)}
            style={{ backgroundColor: c }}
            className={`size-8 rounded-full border-2 ${valor === c ? 'border-foreground' : 'border-transparent'}`}
          />
        ))}
        <input
          type="color"
          aria-label="Otro color"
          value={/^#[0-9a-f]{6}$/.test(valor) ? valor : PALETA[0]}
          onChange={(e) => onCambio(e.target.value.toLowerCase())}
          className="h-8 w-12 cursor-pointer"
        />
        {valor ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onCambio('')}>
            Usar el color predeterminado
          </Button>
        ) : null}
      </div>
      {aviso ? (
        <p role="alert" className="text-sm text-destructive">
          {aviso}
        </p>
      ) : null}
    </div>
  );
}
