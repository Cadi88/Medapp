import type { ComponentProps } from 'react';
import { Label } from '@/components/ui/label';
import { MensajeDeCampo } from '@/features/sesion/components/campo';

interface Props extends Omit<ComponentProps<'select'>, 'id' | 'name'> {
  nombre: string;
  etiqueta: string;
  error?: string | undefined;
}

/** Etiqueta + `<select>` nativo (bueno en móvil y accesible sin trabajo extra) con el estilo de los demás campos. */
export function CampoSelect({ nombre, etiqueta, error, children, ...props }: Props) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={nombre}>{etiqueta}</Label>
      <select
        id={nombre}
        name={nombre}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${nombre}-error` : undefined}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <MensajeDeCampo id={`${nombre}-error`}>{error}</MensajeDeCampo>
    </div>
  );
}
