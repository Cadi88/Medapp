import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));
const vacio = fileURLToPath(new URL('./test/server-only.ts', import.meta.url));

/**
 * Mismo contrato de scripts que `vitest.config.base.ts`, adaptado a Next:
 * - Solo proyecto `unit` (jsdom); el código de servidor declara `@vitest-environment node` por archivo.
 *   `test:integration` corre con --passWithNoTests y no encuentra pruebas.
 * - Cobertura sobre `src/lib/**` y `src/features/**`: las rutas de `src/app/**` son delgadas (las cubre Playwright)
 *   y `src/components/ui/**` es código copiado de shadcn.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': src,
      // `server-only` lanza fuera del bundler de Next; en pruebas es un módulo vacío.
      'server-only': vacio,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'jsdom', include: ['test/unit/**/*.test.{ts,tsx}'] },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', 'test/**'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
