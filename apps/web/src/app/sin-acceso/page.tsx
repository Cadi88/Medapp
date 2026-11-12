import { BotonCerrarSesion } from '@/features/sesion/components/boton-cerrar-sesion';
import { MarcoEntrada } from '@/features/sesion/components/marco-entrada';

export default function SinAccesoPage() {
  return (
    <MarcoEntrada titulo="Sin acceso" descripcion="Tu cuenta no tiene acceso a ningún consultorio, o ya no eres miembro del que elegiste. Pide a la persona administradora que te invite.">
      <BotonCerrarSesion />
    </MarcoEntrada>
  );
}
