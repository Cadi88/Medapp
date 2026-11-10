import { defineConfig, type ViteUserConfig } from 'vitest/config';

/**
 * Config compartida. Cada paquete: `export default baseConfig()` en su vitest.config.ts.
 * Proyectos: unit (sin infraestructura) e integration (Testcontainers).
 * Cobertura v8 sobre la suma unit + integration; umbral 80 % líneas y ramas.
 */
export function baseConfig(overrides: ViteUserConfig = {}) {
  return defineConfig({
    ...overrides,
    test: {
      passWithNoTests: false,
      projects: [
        {
          extends: true,
          test: { name: 'unit', include: ['test/unit/**/*.test.ts'] },
        },
        {
          extends: true,
          test: {
            name: 'integration',
            include: ['test/integration/**/*.test.ts'],
            testTimeout: 60_000,
            hookTimeout: 120_000,
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/main.ts', 'src/testing/**', 'src/index.ts', '**/*.test.ts', 'test/**'],
        reporter: ['text-summary', 'lcov'],
        thresholds: { lines: 80, branches: 80 },
      },
    },
  });
}

export default baseConfig();
