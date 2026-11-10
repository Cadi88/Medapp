import { describe, expect, test } from 'vitest';
import { outboxInboxSql } from '../../src/events/sql.js';

describe('outboxInboxSql', () => {
  test('crea outbox e inbox sin RLS, con índice parcial', () => {
    const sql = outboxInboxSql('svc_app');
    expect(sql).toContain('CREATE TABLE outbox');
    expect(sql).toContain('CREATE TABLE inbox');
    expect(sql).toContain('WHERE publicado_en IS NULL');
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
  test('outbox lleva error/descartado_en y el índice parcial excluye descartados', () => {
    const sql = outboxInboxSql('svc_app');
    expect(sql).toContain('error text NULL');
    expect(sql).toContain('descartado_en timestamptz NULL');
    expect(sql).toContain('WHERE publicado_en IS NULL AND descartado_en IS NULL');
  });
  test('concede SELECT, INSERT, UPDATE y revoca DELETE al rol de la app', () => {
    const sql = outboxInboxSql('svc_app');
    expect(sql).toContain('REVOKE ALL ON outbox, inbox FROM PUBLIC;');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON outbox, inbox TO "svc_app";');
    expect(sql).toContain('REVOKE DELETE ON outbox, inbox FROM "svc_app";');
    expect(sql.indexOf('GRANT SELECT')).toBeLessThan(sql.indexOf('REVOKE DELETE'));
  });
  test.each(['', 'a b', 'x"; DROP TABLE y;--', '1abc', 'a-b'])('rechaza rol inválido %j', (rol) => {
    expect(() => outboxInboxSql(rol)).toThrow(/rol inválido/);
  });
});
