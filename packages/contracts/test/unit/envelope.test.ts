import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  MedicoActualizado,
  TenantCreado,
  UsuarioDesvinculado,
  UsuarioVinculado,
  defineEvent,
  eventEnvelopeSchema,
} from '../../src/index.js';

const T = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const U = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

const tenantData = { tenantId: T, nombre: 'Consultorio Uno', slug: 'uno', zonaHoraria: 'America/Mexico_City', adminUsuarioId: U };
const crear = () => TenantCreado.create({ tenantId: T, actorId: U, traceId: 'abc', data: tenantData });

describe('defineEvent / create', () => {
  test('create produce un sobre válido con UUIDv7 y fecha UTC', () => {
    const e = crear();
    expect(e.type).toBe('tenant.creado');
    expect(e.version).toBe(1);
    expect(e.tenant_id).toBe(T);
    expect(e.actor_id).toBe(U);
    expect(e.trace_id).toBe('abc');
    expect(e.event_id[14]).toBe('7');
    expect(e.occurred_at.endsWith('Z')).toBe(true);
    expect(eventEnvelopeSchema.safeParse(e).success).toBe(true);
  });

  test('occurred_at es un ISO UTC válido y reciente', () => {
    const antes = Date.now();
    const e = crear();
    const t = Date.parse(e.occurred_at);
    expect(new Date(t).toISOString()).toBe(e.occurred_at);
    expect(t).toBeGreaterThanOrEqual(antes - 1);
    expect(t).toBeLessThanOrEqual(Date.now() + 1);
  });

  test('cada evento recibe un event_id distinto', () => {
    expect(crear().event_id).not.toBe(crear().event_id);
  });

  test('actorId null es válido (acciones del sistema)', () => {
    const e = TenantCreado.create({ tenantId: T, actorId: null, traceId: 't', data: tenantData });
    expect(e.actor_id).toBeNull();
    expect(TenantCreado.parse(e).actor_id).toBeNull();
  });

  test('expone type y version de la definición', () => {
    expect(TenantCreado.type).toBe('tenant.creado');
    expect(TenantCreado.version).toBe(1);
  });

  test('defineEvent soporta eventos nuevos', () => {
    const Ev = defineEvent('prueba.hecha', 3, z.object({ n: z.number() }));
    const e = Ev.create({ tenantId: T, actorId: null, traceId: 'x', data: { n: 1 } });
    expect(Ev.parse(e).data.n).toBe(1);
    expect(e.version).toBe(3);
  });
});

describe('parse', () => {
  test('rechaza otro type o versión', () => {
    const e = crear();
    expect(() => UsuarioVinculado.parse(e)).toThrow();
    expect(() => TenantCreado.parse({ ...e, version: 2 })).toThrow();
  });

  test('rechaza data inválida', () => {
    const e = crear();
    expect(() => TenantCreado.parse({ ...e, data: { ...e.data, slug: 1 } })).toThrow();
  });

  test('rechaza un sobre malformado', () => {
    const e = crear();
    expect(() => TenantCreado.parse({ ...e, tenant_id: 'no-es-uuid' })).toThrow();
    expect(() => TenantCreado.parse({ ...e, event_id: 'x' })).toThrow();
    expect(() => TenantCreado.parse({ ...e, occurred_at: 'ayer' })).toThrow();
    expect(() => TenantCreado.parse({ ...e, trace_id: undefined })).toThrow();
    expect(() => TenantCreado.parse(null)).toThrow();
    expect(() => TenantCreado.parse('texto')).toThrow();
  });

  test('devuelve el sobre completo con data tipada', () => {
    const e = crear();
    expect(TenantCreado.parse(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });
});

describe('eventEnvelopeSchema', () => {
  test('rechaza version no entera o menor a 1', () => {
    const e = crear();
    expect(eventEnvelopeSchema.safeParse({ ...e, version: 0 }).success).toBe(false);
    expect(eventEnvelopeSchema.safeParse({ ...e, version: 1.5 }).success).toBe(false);
  });
});

describe('definiciones de eventos de identidad', () => {
  const casos = [
    { def: TenantCreado, type: 'tenant.creado', valida: tenantData, invalida: { ...tenantData, adminUsuarioId: 'x' } },
    { def: UsuarioVinculado, type: 'usuario.vinculado', valida: { usuarioId: U, rol: 'medico' }, invalida: { usuarioId: U, rol: 'root' } },
    { def: UsuarioDesvinculado, type: 'usuario.desvinculado', valida: { usuarioId: U }, invalida: { usuarioId: 5 } },
    {
      def: MedicoActualizado,
      type: 'medico.actualizado',
      valida: { usuarioId: U, cedulaProfesional: '1234567', especialidad: 'Cardiología' },
      invalida: { usuarioId: U, cedulaProfesional: '1234567' },
    },
  ];

  test.each(casos)('$type: acepta data válida y rechaza inválida', ({ def, type, valida, invalida }) => {
    const d = def as unknown as ReturnType<typeof defineEvent<unknown>>;
    expect(d.type).toBe(type);
    expect(d.version).toBe(1);
    const e = d.create({ tenantId: T, actorId: U, traceId: 't', data: valida });
    expect(d.parse(e).data).toEqual(valida);
    expect(() => d.parse({ ...e, data: invalida })).toThrow();
  });
});
