import type { ReactNode } from 'react';
import { BarraDeNavegacion } from '@/features/navegacion/components/BarraDeNavegacion';
import { opcionesDeMenu } from '@/features/navegacion/menu';
import { obtenerContexto } from '@/lib/sesion/contexto';

/** Área autenticada: el proxy ya exige sesión; aquí se arma el menú según el rol y el permiso de administrador. */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { claims, consultorio } = await obtenerContexto();
  return (
    <div className="min-h-screen">
      <BarraDeNavegacion opciones={opcionesDeMenu(claims)} consultorio={consultorio.nombre} />
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  );
}
