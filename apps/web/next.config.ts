import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/** Raíz del monorepo: el trazado de archivos de `standalone` debe ver los paquetes del workspace y el node_modules raíz. */
const raizMonorepo = fileURLToPath(new URL('../..', import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: raizMonorepo,
  transpilePackages: ['@consultorio/contracts'],
  poweredByHeader: false,
};

export default nextConfig;
