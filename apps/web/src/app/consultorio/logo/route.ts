import { redirect } from 'next/navigation';
import { obtenerLogoEnApi } from '@/features/consultorio/api';
import { leerToken } from '@/lib/sesion/cookies';

/**
 * Logo del consultorio de la sesión. El almacenamiento no se expone a internet: el navegador lo pide aquí y Next lo
 * pide al gateway con el token de la persona. No lee la URL: `?v=` solo sirve para romper la caché del navegador y
 * ningún parámetro puede elegir de qué consultorio es el logo.
 */
export async function GET(): Promise<Response> {
  if (!(await leerToken())) redirect('/login');
  const r = await obtenerLogoEnApi();
  if (r.ok) {
    return new Response(r.datos.bytes as BodyInit, {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  return new Response(null, { status: r.status === 404 ? 404 : 503 });
}
