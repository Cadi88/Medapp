-- svc-auditoria: bitácora de auditoría append-only con cadena hash por tenant (spec §3.7, NOM-024).
-- El rol de aplicación es auditoria_app (en pruebas se sustituye el nombre al aplicar la migración).

CREATE TABLE evento_auditoria (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  secuencia bigint NOT NULL CHECK (secuencia >= 1),
  ocurrido_en timestamptz NOT NULL,
  actor_id uuid NULL,
  accion text NOT NULL,
  recurso_tipo text NOT NULL,
  recurso_id text NULL,
  servicio text NOT NULL,
  detalle jsonb NOT NULL,
  hash_anterior text NOT NULL,
  hash text NOT NULL,
  UNIQUE (tenant_id, secuencia)
);

-- Encabezado de la cadena de cada tenant: se bloquea con FOR UPDATE para serializar los registros.
CREATE TABLE cadena (
  tenant_id uuid PRIMARY KEY,
  ultima_secuencia bigint NOT NULL,
  ultimo_hash text NOT NULL
);

ALTER TABLE "evento_auditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evento_auditoria" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "evento_auditoria"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "cadena" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cadena" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cadena"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Privilegios: evento_auditoria es solo de anexado para el rol de aplicación.
REVOKE ALL ON evento_auditoria, cadena FROM PUBLIC;
GRANT SELECT, INSERT ON evento_auditoria TO "auditoria_app";
REVOKE UPDATE, DELETE, TRUNCATE ON evento_auditoria FROM "auditoria_app";
GRANT SELECT, INSERT, UPDATE ON cadena TO "auditoria_app";
REVOKE DELETE, TRUNCATE ON cadena FROM "auditoria_app";

-- FORCE RLS también aplica al dueño de las tablas, y la función SECURITY DEFINER corre como dueño:
-- esta política (solo SELECT, solo para el dueño) le permite listar los tenants sin fijar app.tenant_id.
CREATE POLICY cadena_listado_dueno ON cadena FOR SELECT
  USING (current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.cadena'::regclass));

-- Lista de tenants con cadena para la verificación diaria (devuelve solo tenant_id).
CREATE FUNCTION fn_tenants_auditados()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.tenant_id FROM public.cadena c ORDER BY c.tenant_id
$$;
REVOKE ALL ON FUNCTION fn_tenants_auditados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_tenants_auditados() TO "auditoria_app";

-- Infraestructura de eventos (inbox para el consumidor; outbox sin uso por ahora, igual que en todos los servicios).
CREATE TABLE outbox (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  publicado_en timestamptz NULL,
  error text NULL,
  descartado_en timestamptz NULL
);
CREATE INDEX outbox_pendientes ON outbox (creado_en) WHERE publicado_en IS NULL AND descartado_en IS NULL;
CREATE TABLE inbox (
  event_id uuid NOT NULL,
  consumidor text NOT NULL,
  procesado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumidor)
);
REVOKE ALL ON outbox, inbox FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON outbox, inbox TO "auditoria_app";
REVOKE DELETE ON outbox, inbox FROM "auditoria_app";
