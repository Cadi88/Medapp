import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de navegador (solo Chromium) contra el sitio levantado con `docker compose --profile app up -d --build --wait`.
 * Un solo worker: todas las sesiones salen de la misma IP y Better Auth limita los intentos de acceso por IP.
 */
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:3000',
    locale: 'es-MX',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Alto suficiente para ver toda la jornada del calendario sin desplazarse (el arrastre usa coordenadas).
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1600 } },
    },
  ],
});
