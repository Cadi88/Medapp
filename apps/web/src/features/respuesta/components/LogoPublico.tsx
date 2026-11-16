'use client';

import { useState } from 'react';

/** Logo del consultorio por la ruta pública `/r/<token>/logo`; si no carga, se oculta y queda el nombre. */
export function LogoPublico({ token, nombre }: { token: string; nombre: string }) {
  const [fallo, setFallo] = useState(false);
  if (fallo) return null;
  // eslint-disable-next-line @next/next/no-img-element -- la ruta ya devuelve el PNG reducido; next/image no aporta nada
  return <img src={`/r/${token}/logo`} alt={`Logo de ${nombre}`} className="mx-auto max-h-20 w-auto max-w-48 object-contain" onError={() => setFallo(true)} />;
}
