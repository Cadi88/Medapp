import type { CSSProperties, ReactNode } from 'react';
import { variablesDeTema } from '@/features/consultorio/logica/tema';
import { BarraDeNavegacion } from '@/features/navegacion/components/BarraDeNavegacion';
import { opcionesDeMenu } from '@/features/navegacion/menu';
import { obtenerContexto } from '@/lib/sesion/contexto';

/**
 * Área autenticada: el proxy ya exige sesión; aquí se arma el menú según el rol y el permiso de administrador, y se
 * aplica el color del consultorio (solo a esta área: login y registro conservan el tema por omisión).
 */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { claims, consultorio } = await obtenerContexto();
  return (
    <div className="min-h-screen" style={variablesDeTema(consultorio) as CSSProperties}>
      <BarraDeNavegacion
        opciones={opcionesDeMenu(claims)}
        consultorio={consultorio.nombreComercial ?? consultorio.nombre}
        consultorioId={consultorio.id}
        logoVersion={consultorio.logoVersion}
      />
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  );
}
