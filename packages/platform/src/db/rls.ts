const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** SQL de aislamiento por tenant para una tabla con columna `tenant_id uuid NOT NULL`. */
export function rlsPolicySql(tabla: string): string {
  if (!IDENT_RE.test(tabla)) throw new Error(`tabla inválida: ${JSON.stringify(tabla)}`);
  const expr = "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid";
  return [
    `ALTER TABLE "${tabla}" ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE "${tabla}" FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY tenant_isolation ON "${tabla}"`,
    `  USING (${expr})`,
    `  WITH CHECK (${expr});`,
    '',
  ].join('\n');
}
