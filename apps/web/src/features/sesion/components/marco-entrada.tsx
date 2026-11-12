import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Tarjeta centrada común a las pantallas de entrada. */
export function MarcoEntrada({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{titulo}</CardTitle>
          {descripcion ? <CardDescription>{descripcion}</CardDescription> : null}
        </CardHeader>
        <CardContent className="grid gap-4">{children}</CardContent>
      </Card>
    </main>
  );
}
