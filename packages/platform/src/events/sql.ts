const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * SQL de las tablas de infraestructura de eventos. Sin RLS: no son datos de negocio.
 * `appRole` (`<svc>_app`) recibe SELECT, INSERT, UPDATE; DELETE se revoca explícitamente porque
 * los privilegios por defecto del migrador lo conceden y el outbox/inbox es solo de anexado.
 * La clave del inbox es (event_id, consumidor): varios consumidores del mismo servicio procesan el mismo evento.
 */
export function outboxInboxSql(appRole: string): string {
  if (typeof appRole !== 'string' || !IDENT_RE.test(appRole)) throw new Error(`rol inválido: ${JSON.stringify(appRole)}`);
  return [
    'CREATE TABLE outbox (',
    '  event_id uuid PRIMARY KEY,',
    '  tenant_id uuid NOT NULL,',
    '  type text NOT NULL,',
    '  payload jsonb NOT NULL,',
    '  creado_en timestamptz NOT NULL DEFAULT now(),',
    '  publicado_en timestamptz NULL',
    ');',
    'CREATE INDEX outbox_pendientes ON outbox (creado_en) WHERE publicado_en IS NULL;',
    'CREATE TABLE inbox (',
    '  event_id uuid NOT NULL,',
    '  consumidor text NOT NULL,',
    '  procesado_en timestamptz NOT NULL DEFAULT now(),',
    '  PRIMARY KEY (event_id, consumidor)',
    ');',
    'REVOKE ALL ON outbox, inbox FROM PUBLIC;',
    `GRANT SELECT, INSERT, UPDATE ON outbox, inbox TO "${appRole}";`,
    `REVOKE DELETE ON outbox, inbox FROM "${appRole}";`,
    '',
  ].join('\n');
}
