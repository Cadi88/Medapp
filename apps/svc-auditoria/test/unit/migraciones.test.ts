import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { outboxInboxSql, rlsPolicySql } from '@consultorio/platform';
import { describe, expect, test } from 'vitest';

const m001 = readFileSync(fileURLToPath(new URL('../../migrations/001_auditoria.sql', import.meta.url)), 'utf8');

describe('migración 001_auditoria', () => {
  test('incluye literalmente el SQL de inbox/outbox para auditoria_app (anti-deriva)', () => {
    expect(m001).toContain(outboxInboxSql('auditoria_app'));
  });
  test('RLS estándar en evento_auditoria y cadena', () => {
    expect(m001).toContain(rlsPolicySql('evento_auditoria'));
    expect(m001).toContain(rlsPolicySql('cadena'));
  });
  test('evento_auditoria es de solo anexado para auditoria_app', () => {
    expect(m001).toMatch(/REVOKE ALL ON evento_auditoria, cadena FROM PUBLIC/);
    expect(m001).toMatch(/GRANT SELECT, INSERT ON evento_auditoria TO "auditoria_app"/);
    expect(m001).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE ON evento_auditoria FROM "auditoria_app"/);
    expect(m001).toMatch(/GRANT SELECT, INSERT, UPDATE ON cadena TO "auditoria_app"/);
  });
  test('unicidad (tenant_id, secuencia)', () => {
    expect(m001).toMatch(/UNIQUE \(tenant_id, secuencia\)/);
  });
  test('fn_tenants_auditados: SECURITY DEFINER, search_path fijo, EXECUTE solo para auditoria_app', () => {
    expect(m001).toMatch(/FUNCTION fn_tenants_auditados\(\)/);
    expect(m001).toMatch(/SECURITY DEFINER/);
    expect(m001).toMatch(/SET search_path = public, pg_temp/);
    expect(m001).toMatch(/REVOKE ALL ON FUNCTION fn_tenants_auditados\(\) FROM PUBLIC/);
    expect(m001).toMatch(/GRANT EXECUTE ON FUNCTION fn_tenants_auditados\(\) TO "auditoria_app"/);
  });
});

const m002 = readFileSync(fileURLToPath(new URL('../../migrations/002_integridad_cadena.sql', import.meta.url)), 'utf8');

describe('migración 002_integridad_cadena', () => {
  test('fn_tenants_auditados une cadena y los tenants con eventos (sin encabezado)', () => {
    expect(m002).toMatch(/CREATE OR REPLACE FUNCTION fn_tenants_auditados\(\)/);
    expect(m002).toMatch(/SELECT c\.tenant_id FROM public\.cadena c\s+UNION\s+SELECT DISTINCT e\.tenant_id FROM public\.evento_auditoria e/);
    expect(m002).toMatch(/set_config\('app\.listado_tenants', 'si', true\)/);
    expect(m002).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
    expect(m002).toMatch(/current_setting\('app\.listado_tenants', true\) = 'si'/);
  });
  test('trigger BEFORE INSERT OR UPDATE en cadena que exige avance de uno y el hash de la fila', () => {
    expect(m002).toMatch(/BEFORE INSERT OR UPDATE ON cadena/);
    expect(m002).toMatch(/NEW\.ultima_secuencia IS DISTINCT FROM OLD\.ultima_secuencia \+ 1/);
    expect(m002).toMatch(/e\.secuencia = NEW\.ultima_secuencia/);
  });
  test('no toca el rol por nombre (los privilegios de la 001 se conservan)', () => {
    expect(m002).not.toMatch(/"auditoria_app"/);
  });
});
