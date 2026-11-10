import { readdirSync, existsSync } from 'node:fs';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

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
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.turbo/**', '.superpowers/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': { typescript: { project: ['tsconfig.base.json'], alwaysTryTypes: false } },
    },
    rules: {
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
);
