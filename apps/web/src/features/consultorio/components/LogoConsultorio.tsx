'use client';

import { useState } from 'react';
import { urlDelLogo } from '../logica/logo';

interface Props {
  nombre: string;
  consultorioId: string;
  /** 0 = el consultorio no tiene logo. Cambia con cada logo nuevo y así rompe la caché del navegador. */
  logoVersion: number;
  className?: string;
  /** Se llama cuando la imagen no carga (el encabezado lo ignora; "Mi consultorio" avisa). */
  onFallo?: () => void;
}

const CLASE = 'h-8 w-auto max-w-40 object-contain';

function Imagen({ src, nombre, className, onFallo }: { src: string; nombre: string; className: string; onFallo: (() => void) | undefined }) {
  const [fallo, setFallo] = useState(false);
  if (fallo) return null;
  // eslint-disable-next-line @next/next/no-img-element -- la ruta ya devuelve el PNG reducido; next/image no aporta nada
  return <img src={src} alt={`Logo de ${nombre}`} className={className} onError={() => {
    setFallo(true);
    onFallo?.();
  }} />;
}

/**
 * Logo del consultorio, servido por Next (`/consultorio/logo`). Si la imagen no carga (p. ej. se quitó el logo en
 * otra pestaña o el almacenamiento está caído) se oculta y queda el nombre. El estado de error es por URL: un logo
 * nuevo (otra versión) vuelve a intentar la carga.
 */
export function LogoConsultorio({ nombre, consultorioId, logoVersion, className = CLASE, onFallo }: Props) {
  if (logoVersion <= 0) return null;
  const src = urlDelLogo({ id: consultorioId, logoVersion });
  return <Imagen key={src} src={src} nombre={nombre} className={className} onFallo={onFallo} />;
}
