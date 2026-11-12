'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

/** Botón de envío: se deshabilita y cambia su texto mientras la acción del formulario está en curso. */
export function BotonEnviar({ children, enviando }: { children: ReactNode; enviando: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? enviando : children}
    </Button>
  );
}
