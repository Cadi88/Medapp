import type { Metadata } from 'next';
import { obtenerEnlacePublico } from '@/features/respuesta/api';
import { PaginaRespuesta } from '@/features/respuesta/components/PaginaRespuesta';
import { accionInicial, tieneFormaDeToken } from '@/features/respuesta/logica/enlace';

/** El token está en la dirección: ni se indexa ni se manda como referencia a otros sitios. */
export const metadata: Metadata = { title: 'Tu cita', robots: { index: false, follow: false }, referrer: 'no-referrer' };

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Página pública (sin sesión). Mostrarla nunca registra nada: la respuesta se envía solo con el botón. */
export default async function RespuestaPage({ params, searchParams }: Props) {
  const { token } = await params;
  const accion = accionInicial((await searchParams).accion);
  const r = tieneFormaDeToken(token) ? await obtenerEnlacePublico(token) : undefined;
  const enlace = r === undefined ? ({ estado: 'invalida' } as const) : r.ok ? r.datos : undefined;
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-6 p-6">
      {enlace ? <PaginaRespuesta token={token} enlace={enlace} accion={accion} /> : <p className="text-center">No pudimos cargar tu cita. Intenta de nuevo en unos minutos.</p>}
    </main>
  );
}
