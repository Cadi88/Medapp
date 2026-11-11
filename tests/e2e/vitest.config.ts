import { defineConfig } from 'vitest/config';

// Sin umbrales de cobertura: la E2E ejercita los contenedores, no el código de este paquete.
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
