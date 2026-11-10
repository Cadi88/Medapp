-- svc-identidad: esquema de negocio (spec §3.2).
-- "user" (usuario) y tenant son globales: sin RLS por tenant; el acceso lo controla el servicio.
-- membresia, perfil_medico y datos_fiscales tienen RLS por tenant_id (política estándar de la plataforma).
-- El rol de aplicación es identidad_app (en pruebas se sustituye el nombre al aplicar la migración).

CREATE TABLE tenant (
  id uuid PRIMARY KEY,
  nombre text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  zona_horaria text NOT NULL,
  plan text NOT NULL DEFAULT 'piloto',
  estado_suscripcion text NOT NULL DEFAULT 'piloto',
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE membresia (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  usuario_id uuid NOT NULL REFERENCES "user" (id),
  rol text NOT NULL CHECK (rol IN ('admin', 'medico', 'recepcion')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, usuario_id)
);
CREATE INDEX membresia_usuario ON membresia (usuario_id);

CREATE TABLE perfil_medico (
  tenant_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  cedula_profesional text,
  especialidad text,
  cedula_especialidad text,
  institucion text,
  PRIMARY KEY (tenant_id, usuario_id),
  FOREIGN KEY (tenant_id, usuario_id) REFERENCES membresia (tenant_id, usuario_id)
);

CREATE TABLE datos_fiscales (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id),
  rfc text,
  razon_social text,
  regimen_fiscal text,
  cp text,
  pac_emisor_id text
);

ALTER TABLE "membresia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membresia" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "membresia"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "perfil_medico" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "perfil_medico" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "perfil_medico"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "datos_fiscales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "datos_fiscales" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "datos_fiscales"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Lectura de membresías de UN usuario sin tenant activo (login / selección de consultorio).
-- Es el único acceso a membresia fuera de un tenant. La tabla tiene FORCE RLS (también para el dueño),
-- por eso se añade una política de solo lectura para el rol que ejecuta esta migración (el migrador,
-- dueño de la función SECURITY DEFINER); identidad_app no la tiene y solo llega a las filas vía la función.
CREATE POLICY lectura_por_funcion_definer ON membresia FOR SELECT TO CURRENT_USER USING (true);

CREATE FUNCTION fn_membresias_usuario(p_usuario uuid)
RETURNS TABLE (tenant_id uuid, nombre text, slug text, rol text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.tenant_id, t.nombre, t.slug, m.rol
  FROM membresia m JOIN tenant t ON t.id = m.tenant_id
  WHERE m.usuario_id = p_usuario
  ORDER BY t.nombre, m.tenant_id
$$;
REVOKE ALL ON FUNCTION fn_membresias_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_membresias_usuario(uuid) TO "identidad_app";

-- Infraestructura de eventos (outbox / inbox).
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
GRANT SELECT, INSERT, UPDATE ON outbox, inbox TO "identidad_app";
REVOKE DELETE ON outbox, inbox FROM "identidad_app";
