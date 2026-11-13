import type { ComponentProps, ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CampoProps extends Omit<ComponentProps<typeof Input>, 'id' | 'name'> {
  nombre: string;
  etiqueta: string;
  error?: string | undefined;
  /** Adorno fijo antes de la entrada (p. ej. el prefijo telefónico del país). */
  prefijo?: string;
}

/** Etiqueta + entrada + mensaje de error accesible (`aria-invalid`, `aria-describedby`). */
export function Campo({ nombre, etiqueta, error, prefijo, ...props }: CampoProps) {
  const entrada = (
    <Input
      id={nombre}
      name={nombre}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${nombre}-error` : undefined}
      {...props}
    />
  );
  return (
    <div className="grid gap-2">
      <Label htmlFor={nombre}>{etiqueta}</Label>
      {prefijo ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{prefijo}</span>
          {entrada}
        </div>
      ) : (
        entrada
      )}
      <MensajeDeCampo id={`${nombre}-error`}>{error}</MensajeDeCampo>
    </div>
  );
}

export function MensajeDeCampo({ id, children }: { id: string; children?: ReactNode }) {
  return children ? (
    <p id={id} className="text-sm text-destructive">
      {children}
    </p>
  ) : null;
}

/** Error general del formulario (no de un campo). */
export function AvisoDeError({ mensaje }: { mensaje?: string | undefined }) {
  return mensaje ? (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {mensaje}
    </p>
  ) : null;
}
