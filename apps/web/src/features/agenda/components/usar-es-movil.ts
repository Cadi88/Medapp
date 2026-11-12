'use client';

import { useSyncExternalStore } from 'react';

const CONSULTA = '(max-width: 767px)';

function suscribir(avisar: () => void): () => void {
  if (typeof globalThis.matchMedia !== 'function') return () => undefined;
  const lista = globalThis.matchMedia(CONSULTA);
  lista.addEventListener('change', avisar);
  return () => lista.removeEventListener('change', avisar);
}

const instantanea = (): boolean => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(CONSULTA).matches;

/** `true` por debajo de 768 px. En el servidor (y en la hidratación) es `false`: se dibuja el calendario. */
export function useEsMovil(): boolean {
  return useSyncExternalStore(suscribir, instantanea, () => false);
}
