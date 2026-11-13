import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/** Raíz del monorepo: el trazado de archivos de `standalone` debe ver los paquetes del workspace y el node_modules raíz. */
const raizMonorepo = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Cabeceras de seguridad para todas las rutas: nadie puede incrustar el sitio en un marco (clickjacking), el navegador
 * no adivina tipos de contenido y el Referer no sale con la ruta completa hacia otros sitios. La CSP se limita a
 * `frame-ancestors`: Next y FullCalendar insertan scripts y estilos en línea, así que no se restringen aquí.
 */
const CABECERAS_DE_SEGURIDAD = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: raizMonorepo,
  transpilePackages: ['@consultorio/contracts'],
  poweredByHeader: false,
  // El logo (hasta 1 MB) viaja en una acción del servidor; el límite por omisión de 1 MB lo cortaría antes de validarlo.
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  headers: async () => [{ source: '/:path*', headers: CABECERAS_DE_SEGURIDAD }],
};

export default nextConfig;
