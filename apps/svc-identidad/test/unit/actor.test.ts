import { describe, expect, test } from 'vitest';
import { actorAutorizado, exigirActor, exigirActorVigente } from '../../src/actor.js';
import { debeRevocarOtras } from '../../src/revocar-sesiones.js';

const MEDICO = { rol: 'medico', admin: false } as const;
const MEDICO_ADMIN = { rol: 'medico', admin: true } as const;
const RECEPCION = { rol: 'recepcion', admin: false } as const;
const RECEPCION_ADMIN = { rol: 'recepcion', admin: true } as const;

describe('actorAutorizado / exigirActorVigente (estado vigente en BD)', () => {
  test('sin membresia (removido) no esta autorizado', () => {
    expect(actorAutorizado(undefined, { admin: true })).toBe(false);
    expect(actorAutorizado(undefined, {})).toBe(false);
    expect(() => exigirActorVigente(undefined, { admin: true })).toThrow(expect.objectContaining({ code: 'PROHIBIDO', status: 403 }));
  });
  test('admin: true exige el permiso, sea cual sea el rol de trabajo', () => {
    expect(() => exigirActorVigente(MEDICO, { admin: true })).toThrow(expect.objectContaining({ code: 'PROHIBIDO' }));
    expect(() => exigirActorVigente(RECEPCION, { admin: true })).toThrow(expect.objectContaining({ code: 'PROHIBIDO' }));
    expect(exigirActorVigente(RECEPCION_ADMIN, { admin: true })).toEqual(RECEPCION_ADMIN);
  });
  test('roles restringe el rol de trabajo', () => {
    expect(() => exigirActorVigente(RECEPCION, { roles: ['medico'] })).toThrow(expect.objectContaining({ code: 'PROHIBIDO' }));
    expect(exigirActorVigente(MEDICO, { roles: ['medico'] })).toEqual(MEDICO);
  });
  test('las condiciones se combinan con AND', () => {
    expect(actorAutorizado(MEDICO, { admin: true, roles: ['medico'] })).toBe(false);
    expect(actorAutorizado(RECEPCION_ADMIN, { admin: true, roles: ['medico'] })).toBe(false);
    expect(actorAutorizado(MEDICO_ADMIN, { admin: true, roles: ['medico'] })).toBe(true);
  });
  test('sin requisitos basta con ser miembro', () => {
    expect(exigirActorVigente(RECEPCION, {})).toEqual(RECEPCION);
  });
});

describe('exigirActor', () => {
  const doble = (rows: { rol: string; admin: boolean }[]) => {
    const llamadas: { sql: string; params: unknown[] }[] = [];
    const tx = {
      query: async (sql: string, params: unknown[]) => {
        llamadas.push({ sql, params });
        return { rows };
      },
    } as never;
    return { llamadas, tx };
  };
  test('consulta la membresia del actor con FOR SHARE y devuelve rol y admin', async () => {
    const t = doble([MEDICO_ADMIN]);
    expect(await exigirActor(t.tx, { tenantId: 't', usuarioId: 'u' }, { admin: true })).toEqual(MEDICO_ADMIN);
    expect(t.llamadas[0]?.sql).toMatch(/FOR SHARE/);
    expect(t.llamadas[0]?.params).toEqual(['t', 'u']);
  });
  test('sin fila da 403', async () => {
    await expect(exigirActor(doble([]).tx, { tenantId: 't', usuarioId: 'u' }, { admin: true })).rejects.toMatchObject({ code: 'PROHIBIDO' });
  });
  test('sin admin cuando se exige da 403; sin requisitos solo pide ser miembro', async () => {
    await expect(exigirActor(doble([MEDICO]).tx, { tenantId: 't', usuarioId: 'u' }, { admin: true })).rejects.toMatchObject({ code: 'PROHIBIDO' });
    expect(await exigirActor(doble([RECEPCION]).tx, { tenantId: 't', usuarioId: 'u' })).toEqual(RECEPCION);
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
