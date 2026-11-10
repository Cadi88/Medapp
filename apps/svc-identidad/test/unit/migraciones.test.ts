import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { outboxInboxSql, rlsPolicySql } from '@consultorio/platform';
import { describe, expect, test } from 'vitest';

const leer = (f: string) => readFileSync(fileURLToPath(new URL(`../../migrations/${f}`, import.meta.url)), 'utf8');

describe('migraciones', () => {
  const m001 = leer('001_better_auth.sql');
  const m002 = leer('002_identidad.sql');

  test('001: tablas de Better Auth con ids uuid y sin RLS', () => {
    for (const t of ['user', 'session', 'account', 'verification', 'twoFactor']) expect(m001).toContain(`create table "${t}"`);
    expect(m001).not.toMatch(/"id" text/);
    expect(m001).not.toMatch(/"userId" text/);
    expect(m001).not.toMatch(/row level security/i);
  });

  test('002: incluye literalmente el SQL de outbox/inbox para identidad_app (anti-deriva)', () => {
    expect(m002).toContain(outboxInboxSql('identidad_app'));
  });

  test('002: RLS con la política estándar en membresia, perfil_medico y datos_fiscales', () => {
    for (const t of ['membresia', 'perfil_medico', 'datos_fiscales']) expect(m002).toContain(rlsPolicySql(t));
  });

  test('002: tenant es global (sin RLS) con defaults de plan y suscripción', () => {
    expect(m002).not.toContain(rlsPolicySql('tenant'));
    expect(m002).toMatch(/plan text NOT NULL DEFAULT 'piloto'/);
    expect(m002).toMatch(/estado_suscripcion text NOT NULL DEFAULT 'piloto'/);
  });

  test('002: fn_membresias_usuario es SECURITY DEFINER con search_path fijo y EXECUTE solo para identidad_app', () => {
    expect(m002).toMatch(/FUNCTION fn_membresias_usuario\(p_usuario uuid\)/);
    expect(m002).toMatch(/SECURITY DEFINER/);
    expect(m002).toMatch(/SET search_path = public, pg_temp/);
    expect(m002).toMatch(/REVOKE ALL ON FUNCTION fn_membresias_usuario\(uuid\) FROM PUBLIC/);
    expect(m002).toMatch(/GRANT EXECUTE ON FUNCTION fn_membresias_usuario\(uuid\) TO "identidad_app"/);
  });
});
