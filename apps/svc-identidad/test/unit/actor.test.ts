import { describe, expect, test } from 'vitest';
import { actorAutorizado, exigirActor, exigirRolVigente } from '../../src/actor.js';
import { debeRevocarOtras } from '../../src/revocar-sesiones.js';

describe('actorAutorizado / exigirRolVigente (rol vigente en BD)', () => {
  test('sin membresia (removido) no esta autorizado', () => {
    expect(actorAutorizado(undefined, ['admin'])).toBe(false);
    expect(() => exigirRolVigente(undefined, ['admin'])).toThrow(expect.objectContaining({ code: 'PROHIBIDO', status: 403 }));
  });
  test('rol fuera de los permitidos da 403', () => {
    expect(() => exigirRolVigente('recepcion', ['admin'])).toThrow(expect.objectContaining({ code: 'PROHIBIDO' }));
    expect(() => exigirRolVigente('medico', ['admin'])).toThrow(expect.objectContaining({ code: 'PROHIBIDO' }));
  });
  test('rol permitido se devuelve', () => {
    expect(exigirRolVigente('admin', ['admin', 'medico'])).toBe('admin');
    expect(exigirRolVigente('medico', ['admin', 'medico'])).toBe('medico');
  });
});

describe('exigirActor', () => {
  const doble = (rows: { rol: string }[]) => {
    const llamadas: { sql: string; params: unknown[] }[] = [];
    const tx = {
      query: async (sql: string, params: unknown[]) => {
        llamadas.push({ sql, params });
        return { rows };
      },
    } as never;
    return { llamadas, tx };
  };
  test('consulta la membresia del actor con FOR SHARE y devuelve el rol', async () => {
    const t = doble([{ rol: 'admin' }]);
    expect(await exigirActor(t.tx, { tenantId: 't', usuarioId: 'u' }, ['admin'])).toBe('admin');
    expect(t.llamadas[0]?.sql).toMatch(/FOR SHARE/);
    expect(t.llamadas[0]?.params).toEqual(['t', 'u']);
  });
  test('sin fila da 403', async () => {
    await expect(exigirActor(doble([]).tx, { tenantId: 't', usuarioId: 'u' }, ['admin'])).rejects.toMatchObject({ code: 'PROHIBIDO' });
  });
});

describe('debeRevocarOtras', () => {
  test.each([
    [false, true, true],
    [false, false, false],
    [true, true, false],
    [true, false, false],
  ])('antes=%s despues=%s resulta %s', (antes, despues, esperado) => {
    expect(debeRevocarOtras({ antes, despues })).toBe(esperado);
  });
});
