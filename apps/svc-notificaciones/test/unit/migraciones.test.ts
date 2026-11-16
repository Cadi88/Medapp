import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { outboxInboxSql, rlsPolicySql } from '@consultorio/platform';
import { describe, expect, test } from 'vitest';

const m001 = readFileSync(fileURLToPath(new URL('../../migrations/001_notificaciones.sql', import.meta.url)), 'utf8');
const TABLAS = ['config_recordatorios', 'envio', 'corrida', 'consultorio'];

describe('migración 001_notificaciones', () => {
  test('incluye literalmente el SQL de inbox/outbox para notificaciones_app (anti-deriva)', () => {
    expect(m001).toContain(outboxInboxSql('notificaciones_app'));
  });
  test.each(TABLAS)('RLS estándar y CREATE TABLE en %s', (t) => {
    expect(m001).toContain(rlsPolicySql(t));
    expect(m001).toContain(`CREATE TABLE ${t} (`);
  });
  test('envio: unicidad por cita, fecha y canal e índice por fecha', () => {
    expect(m001).toMatch(/UNIQUE \(tenant_id, cita_id, fecha_cita, canal\)/);
    expect(m001).toMatch(/CREATE INDEX envio_por_fecha ON envio \(tenant_id, fecha_cita\)/);
  });
  test('envio no guarda datos de contacto', () => {
    const envio = m001.slice(m001.indexOf('CREATE TABLE envio ('), m001.indexOf('CREATE INDEX envio_por_fecha'));
    expect(envio).not.toMatch(/telefono|email|correo_destino|contacto/i);
  });
  test('fn_envio_por_token: SECURITY DEFINER, search_path fijo, EXECUTE solo para notificaciones_app', () => {
    expect(m001).toMatch(/fn_envio_por_token\(p_hash text\)\s+RETURNS TABLE \(tenant_id uuid, envio_id uuid\)/);
    expect(m001).toMatch(/SECURITY DEFINER/);
    expect(m001).toMatch(/SET search_path = public, pg_temp/);
    expect(m001).toMatch(/REVOKE ALL ON FUNCTION fn_envio_por_token\(text\) FROM PUBLIC;/);
    expect(m001).toMatch(/GRANT EXECUTE ON FUNCTION fn_envio_por_token\(text\) TO "notificaciones_app";/);
  });
});
