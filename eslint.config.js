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

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.turbo/**', '.superpowers/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: { import: importPlugin },
    rules: { 'import/no-restricted-paths': ['error', { zones: zonas }] },
  },
);
