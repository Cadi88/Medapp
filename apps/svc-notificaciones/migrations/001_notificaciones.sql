-- svc-notificaciones: recordatorios de citas (spec 1c §4.1). El rol de aplicación es notificaciones_app
-- (en pruebas se sustituye el nombre al aplicar la migración). Sin datos de contacto del paciente.

CREATE TABLE config_recordatorios (
  tenant_id uuid PRIMARY KEY,
  modo text NOT NULL DEFAULT 'con_revision' CHECK (modo IN ('con_revision', 'sin_revision')),
  hora_envio time NOT NULL DEFAULT '10:00',
  zona_horaria text NOT NULL,
  plantilla_correo_asunto text NOT NULL CHECK (char_length(plantilla_correo_asunto) BETWEEN 1 AND 120),
  plantilla_correo_cuerpo text NOT NULL CHECK (char_length(plantilla_correo_cuerpo) BETWEEN 1 AND 1000),
  plantilla_whatsapp text NOT NULL CHECK (char_length(plantilla_whatsapp) BETWEEN 1 AND 700),
  actualizada_por uuid NOT NULL,
  actualizada_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE envio (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cita_id uuid NOT NULL,
  fecha_cita date NOT NULL,
  canal text NOT NULL CHECK (canal IN ('correo', 'whatsapp_asistido')),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'enviado', 'fallido', 'anulado')),
  aprobado_por uuid NULL,
  aprobado_en timestamptz NULL,
  enviado_por uuid NULL,
  enviado_en timestamptz NULL,
  intentos int NOT NULL DEFAULT 0 CHECK (intentos BETWEEN 0 AND 3),
  token_hash text NULL,
  token_expira_en timestamptz NULL,
  respuesta text NULL CHECK (respuesta IN ('confirma', 'cancela', 'pide_cambio')),
  respondido_en timestamptz NULL,
  respondido_por text NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cita_id, fecha_cita, canal)
);
CREATE INDEX envio_por_fecha ON envio (tenant_id, fecha_cita);
CREATE UNIQUE INDEX envio_token_hash ON envio (token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE corrida (
  tenant_id uuid NOT NULL,
  fecha_envio date NOT NULL,
  terminada_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, fecha_envio)
);

CREATE TABLE consultorio (
  tenant_id uuid PRIMARY KEY,
  zona_horaria text NOT NULL
);

ALTER TABLE "config_recordatorios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "config_recordatorios" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "config_recordatorios"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "envio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "envio" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "envio"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "corrida" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "corrida" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "corrida"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "consultorio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultorio" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "consultorio"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL ON config_recordatorios, envio, corrida, consultorio FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON config_recordatorios, envio, corrida, consultorio TO "notificaciones_app";

-- Búsqueda de un envío por el hash de su token SIN consultorio conocido (la página pública solo trae el token).
-- envio tiene FORCE RLS (también para el dueño): se añade una política de solo lectura para el rol que ejecuta
-- esta migración (el migrador, dueño de la función SECURITY DEFINER); notificaciones_app no la tiene y solo
-- llega a las filas vía la función, que devuelve únicamente tenant_id y envio_id (envio no guarda contacto).
CREATE POLICY lectura_por_funcion_definer ON envio FOR SELECT TO CURRENT_USER USING (true);

CREATE FUNCTION fn_envio_por_token(p_hash text)
RETURNS TABLE (tenant_id uuid, envio_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.tenant_id, e.id FROM envio e WHERE e.token_hash = p_hash
$$;
REVOKE ALL ON FUNCTION fn_envio_por_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_envio_por_token(text) TO "notificaciones_app";

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
GRANT SELECT, INSERT, UPDATE ON outbox, inbox TO "notificaciones_app";
REVOKE DELETE ON outbox, inbox FROM "notificaciones_app";
