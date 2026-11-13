'use client';

import { useState } from 'react';

interface Props {
  nombre: string;
  /** 0 = el consultorio no tiene logo. Cambia con cada logo nuevo y así rompe la caché del navegador. */
  logoVersion: number;
  className?: string;
}

/**
 * Logo del consultorio, servido por Next (`/consultorio/logo`). Si la imagen no carga (p. ej. se quitó el logo en
 * otra pestaña o el almacenamiento está caído) se oculta y queda el nombre.
 */
export function LogoConsultorio({ nombre, logoVersion, className = 'h-8 w-auto max-w-40 object-contain' }: Props) {
  const [fallo, setFallo] = useState(false);
  if (logoVersion <= 0 || fallo) return null;
  // eslint-disable-next-line @next/next/no-img-element -- la ruta ya devuelve el PNG reducido; next/image no aporta nada
  return <img src={`/consultorio/logo?v=${logoVersion}`} alt={`Logo de ${nombre}`} className={className} onError={() => setFallo(true)} />;
}
