'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoConsultorio } from '@/features/consultorio/components/LogoConsultorio';
import { BotonCerrarSesion } from '@/features/sesion/components/boton-cerrar-sesion';
import type { OpcionDeMenu } from '../menu';

/** Una sección sigue marcada en sus subrutas (`/medicos/abc` marca "Médicos"). */
const estaActiva = (ruta: string, href: string) => ruta === href || ruta.startsWith(`${href}/`);

interface Props {
  opciones: OpcionDeMenu[];
  /** Nombre que se muestra: el nombre comercial o, sin él, el del consultorio. */
  consultorio: string;
  /** 0 = sin logo. */
  logoVersion?: number;
}

export function BarraDeNavegacion({ opciones, consultorio, logoVersion = 0 }: Props) {
  const ruta = usePathname();
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="flex items-center gap-2">
          <LogoConsultorio nombre={consultorio} logoVersion={logoVersion} />
          <span className="font-semibold">{consultorio}</span>
        </span>
        <nav aria-label="Principal" className="flex flex-1 flex-wrap gap-1">
          {opciones.map((o) => {
            const activa = estaActiva(ruta, o.href);
            return (
              <Link
                key={o.href}
                href={o.href}
                {...(activa ? { 'aria-current': 'page' as const } : {})}
                className={`rounded-md px-3 py-1.5 text-sm ${activa ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {o.texto}
              </Link>
            );
          })}
        </nav>
        <BotonCerrarSesion />
      </div>
    </header>
  );
}
