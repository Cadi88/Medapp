import { expect, test } from 'vitest';
import { TenantCreado, TenantCreadoV1 } from '../../src/index.js';

const T = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const base = { tenantId: T, nombre: 'C', slug: 'c-uno', zonaHoraria: 'America/Mexico_City', adminUsuarioId: T };

test('tenant.creado v2 lleva país y moneda; v1 sigue disponible sin ellos', () => {
  const v2 = TenantCreado.create({ tenantId: T, actorId: null, traceId: 't', data: { ...base, pais: 'MX', moneda: 'MXN' } });
  expect(v2).toMatchObject({ type: 'tenant.creado', version: 2 });
  expect(TenantCreado.parse(v2).data).toEqual({ ...base, pais: 'MX', moneda: 'MXN' });
  expect(() => TenantCreado.parse({ ...v2, data: { ...base, pais: 'XX', moneda: 'MXN' } })).toThrow();
  expect(() => TenantCreado.parse(TenantCreadoV1.create({ tenantId: T, actorId: null, traceId: 't', data: base }))).toThrow();
  const v1 = TenantCreadoV1.create({ tenantId: T, actorId: null, traceId: 't', data: base });
  expect(v1).toMatchObject({ type: 'tenant.creado', version: 1 });
});
