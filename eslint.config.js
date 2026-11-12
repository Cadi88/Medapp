import { readdirSync, existsSync } from 'node:fs';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

// Un app no puede importar otro app: por cada apps/<x>, prohibir importar el resto de apps/.
const apps = existsSync('apps') ? readdirSync('apps', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
const zonas = [
  ...apps.map((app) => ({
    target: `./apps/${app}`,
    from: './apps',
    except: [`./${app}`],
    message: 'apps/* no puede importar de otro apps/*; extraer a packages/*.',
  })),
  { target: './packages', from: './apps', message: 'packages/* no puede depender de apps/*.' },
];

// Imports por nombre de paquete (vía symlink de node_modules): @consultorio/<app> y @consultorio/svc-<app>.
const patronesApps = apps.flatMap((app) => [`@consultorio/${app}`, `@consultorio/${app}/*`, `@consultorio/svc-${app}`, `@consultorio/svc-${app}/*`]);

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.turbo/**', '.superpowers/**', '**/.next/**', '**/next-env.d.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': { typescript: { project: ['tsconfig.base.json'], alwaysTryTypes: false } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'import/no-restricted-paths': ['error', { zones: zonas }],
      ...(patronesApps.length
        ? {
            'no-restricted-imports': [
              'error',
              { patterns: [{ group: patronesApps, message: 'apps/* no se importan por nombre de paquete; extraer a packages/*.' }] },
            ],
          }
        : {}),
    },
  },
  // Capa de dominio: funciones puras, sin infraestructura. (Se repiten los patrones de apps/*: la regla se reemplaza, no se mezcla.)
  {
    files: ['apps/*/src/dominio/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pg', message: 'El dominio es puro: el acceso a datos va en src/datos.' },
            { name: 'fastify', message: 'El dominio es puro: HTTP va en src/rutas.' },
            { name: '@consultorio/platform', message: 'El dominio no depende de la plataforma; recibe sus datos como parámetros.' },
          ],
          patterns: [
            { group: ['pg/*'], message: 'El dominio es puro: el acceso a datos va en src/datos.' },
            { group: ['fastify/*', '@fastify/*'], message: 'El dominio es puro: HTTP va en src/rutas.' },
            { group: ['@nats-io/*'], message: 'El dominio es puro: la mensajería no se importa aquí.' },
            { group: ['@consultorio/platform/*'], message: 'El dominio no depende de la plataforma; recibe sus datos como parámetros.' },
            ...(patronesApps.length ? [{ group: patronesApps, message: 'apps/* no se importan por nombre de paquete; extraer a packages/*.' }] : []),
          ],
        },
      ],
    },
  },
  // Sitio web (Next.js + React): reglas de Next (core web vitals) y de hooks de React.
  // `no-html-link-for-pages` es solo para el directorio pages/; el sitio usa App Router.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: nextPlugin.configs['core-web-vitals'].plugins,
    rules: { ...nextPlugin.configs['core-web-vitals'].rules, '@next/next/no-html-link-for-pages': 'off' },
  },
  { files: ['apps/web/**/*.{ts,tsx}'], ...reactHooks.configs.flat.recommended },
);
