import { obtenerLogoPublico } from '@/features/respuesta/api';
import { tieneFormaDeToken } from '@/features/respuesta/logica/enlace';

/**
 * Logo del consultorio para la página pública. El navegador no habla con el gateway: lo pide aquí y Next lo pide al
 * gateway con el token del enlace (sin sesión). No se registra el token.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  if (!tieneFormaDeToken(token)) return new Response(null, { status: 404 });
  const r = await obtenerLogoPublico(token);
  if (!r.ok) return new Response(null, { status: r.status === 404 ? 404 : 503 });
  const tipo = r.datos.tipo;
  return new Response(r.datos.bytes as BodyInit, {
    headers: {
      'content-type': tipo.startsWith('image/') ? tipo : 'application/octet-stream',
      'cache-control': r.datos.cabeceras.get('cache-control') ?? 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
