'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/** Frontera de error de toda la aplicación: aviso genérico y reintento; nunca se muestran detalles internos. */
export default function ErrorGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Solo el resumen (digest) queda en consola; el mensaje puede traer datos internos.
    console.error('Error de la aplicación', error.digest);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="alert">Ocurrió un error. Intenta de nuevo.</p>
      <Button onClick={reset}>Reintentar</Button>
    </main>
  );
}
