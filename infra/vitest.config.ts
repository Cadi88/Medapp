import { defineConfig } from 'vitest/config';

// Sin umbral de cobertura (infra queda fuera de los umbrales del proyecto). La síntesis de las 4 stacks tarda unos segundos.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 },
});
