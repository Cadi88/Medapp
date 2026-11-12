import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { BotonCerrarSesion } from '@/features/sesion/components/boton-cerrar-sesion';
import { MarcoEntrada } from '@/features/sesion/components/marco-entrada';

export default function SinAccesoPage() {
  return (
    <MarcoEntrada
      titulo="No tienes acceso"
      descripcion="No tienes permiso para ver esta sección, o ya no perteneces a este consultorio. Si crees que es un error, pide ayuda a la persona administradora."
    >
      <Button asChild>
        <Link href="/agenda">Volver a la agenda</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/elegir-consultorio">Elegir otro consultorio</Link>
      </Button>
      <BotonCerrarSesion />
    </MarcoEntrada>
  );
}
