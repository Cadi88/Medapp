import { describe, expect, test } from 'vitest';
import { requireAdmin, requireRole } from '../../src/index.js';

describe('requireAdmin', () => {
  test('sin ctx autenticado → 401 NO_AUTENTICADO', async () => {
    await expect(requireAdmin()({})).rejects.toMatchObject({ code: 'NO_AUTENTICADO', status: 401 });
    await expect(requireAdmin()({ ctx: {} })).rejects.toMatchObject({ code: 'NO_AUTENTICADO', status: 401 });
  });
  test('admin=false → 403 PROHIBIDO', async () => {
    await expect(requireAdmin()({ ctx: { admin: false, rol: 'medico' } })).rejects.toMatchObject({ code: 'PROHIBIDO', status: 403 });
  });
  test.each(['medico', 'recepcion'] as const)('admin=true con rol %s → pasa', async (rol) => {
    await expect(requireAdmin()({ ctx: { admin: true, rol } })).resolves.toBeUndefined();
  });
});

describe('requireRole (rol de trabajo)', () => {
  test('rol fuera de la lista → 403; dentro → pasa; sin ctx → 401', async () => {
    await expect(requireRole('medico')({ ctx: { rol: 'recepcion' } })).rejects.toMatchObject({ code: 'PROHIBIDO' });
    await expect(requireRole('medico')({ ctx: { rol: 'medico' } })).resolves.toBeUndefined();
    await expect(requireRole('medico')({})).rejects.toMatchObject({ code: 'NO_AUTENTICADO' });
  });
});
