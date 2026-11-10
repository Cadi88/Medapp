import { defineConfig, type ViteUserConfig } from 'vitest/config';

/**
 * Contrato de scripts por paquete (copiar tal cual en cada package.json):
 *   "test":             "vitest run --coverage"          (ambos proyectos; aplica umbrales 80 % líneas/ramas)
 *   "test:unit":        "vitest run --project unit"
 *   "test:integration": "vitest run --project integration --passWithNoTests"
 * `integration` lleva --passWithNoTests (la opción por proyecto en config es ignorada por vitest, debe ir en el CLI);
 * `unit` no: todo paquete debe tener pruebas unitarias.
 *
 * Config compartida. Cada paquete: `export default baseConfig()` en su vitest.config.ts.
 * Proyectos: unit (sin infraestructura) e integration (Testcontainers).
 * Cobertura v8 sobre la suma unit + integration; umbral 80 % líneas y ramas.
 */
export function baseConfig(overrides: ViteUserConfig = {}) {
  return defineConfig({
    ...overrides,
    test: {
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
