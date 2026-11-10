import { describe, expect, test } from 'vitest';
import { rlsPolicySql } from '../../src/index.js';

describe('rlsPolicySql', () => {
  test('habilita y fuerza RLS y crea la política con NULLIF', () => {
    const sql = rlsPolicySql('nota');
    expect(sql).toContain('ALTER TABLE "nota" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "nota" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain('CREATE POLICY tenant_isolation ON "nota"');
    const expr = "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid";
    expect(sql).toContain(`USING (${expr})`);
    expect(sql).toContain(`WITH CHECK (${expr})`);
  });
  test.each(['nota; drop table x', 'a"b', '1abc', '', 'a b', 'a-b'])('rechaza el identificador %j', (t) => {
    expect(() => rlsPolicySql(t)).toThrow('tabla inválida');
  });
});
