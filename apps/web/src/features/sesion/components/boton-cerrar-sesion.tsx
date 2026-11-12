'use client';

import { Button } from '@/components/ui/button';
import { cerrarSesion } from '../actions';

export function BotonCerrarSesion() {
  return (
    <form action={cerrarSesion}>
      <Button type="submit" variant="outline">
        Cerrar sesión
      </Button>
    </form>
  );
}
