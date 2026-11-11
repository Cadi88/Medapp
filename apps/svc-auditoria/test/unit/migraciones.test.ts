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
