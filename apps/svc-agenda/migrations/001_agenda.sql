-- svc-agenda: esquema de citas (spec §3.1). Copia local de consultorio y médicos (alimentada por eventos de identidad).
-- El rol de aplicación es agenda_app (en pruebas se sustituye el nombre al aplicar la migración).
-- Las invariantes críticas viven aquí: sin doble reserva, horarios sin encimarse, duración válida.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE consultorio (
  tenant_id uuid PRIMARY KEY,
  zona_horaria text NOT NULL
);

CREATE TABLE medico (
  tenant_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, usuario_id)
);

CREATE TABLE tipo_cita (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  medico_id uuid NOT NULL,
  nombre text NOT NULL,
  duracion_min int NOT NULL CHECK (duracion_min BETWEEN 5 AND 480),
  activo boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, medico_id) REFERENCES medico (tenant_id, usuario_id)
);
CREATE UNIQUE INDEX tipo_cita_nombre_activo ON tipo_cita (tenant_id, medico_id, lower(nombre)) WHERE activo;

CREATE TABLE horario (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  medico_id uuid NOT NULL,
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  CHECK (hora_inicio < hora_fin),
  FOREIGN KEY (tenant_id, medico_id) REFERENCES medico (tenant_id, usuario_id),
  EXCLUDE USING gist (
    tenant_id WITH =,
    medico_id WITH =,
    dia_semana WITH =,
    tsrange(DATE '2000-01-01' + hora_inicio, DATE '2000-01-01' + hora_fin) WITH &&
  )
);

CREATE TABLE bloqueo (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  medico_id uuid NOT NULL,
  rango tstzrange NOT NULL CHECK (NOT isempty(rango)),
  motivo text,
  FOREIGN KEY (tenant_id, medico_id) REFERENCES medico (tenant_id, usuario_id)
);

CREATE TABLE cita (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  medico_id uuid NOT NULL,
  tipo_cita_id uuid NOT NULL,
  rango tstzrange NOT NULL CHECK (NOT isempty(rango)),
  estado text NOT NULL CHECK (estado IN ('agendada', 'confirmada', 'atendida', 'cancelada', 'no_asistio')),
  contacto_nombre text NOT NULL,
  contacto_telefono text NOT NULL,
  contacto_email text NULL,
  notas text NULL,
  fuera_de_horario boolean NOT NULL DEFAULT false,
  origen text NOT NULL CHECK (origen IN ('recepcion')),
  creada_por uuid NOT NULL,
  version int NOT NULL DEFAULT 1,
  creada_en timestamptz NOT NULL DEFAULT now(),
  actualizada_en timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, medico_id) REFERENCES medico (tenant_id, usuario_id),
  FOREIGN KEY (tenant_id, tipo_cita_id) REFERENCES tipo_cita (tenant_id, id),
  CONSTRAINT cita_sin_traslape EXCLUDE USING gist (
    tenant_id WITH =,
    medico_id WITH =,
    rango WITH &&
  ) WHERE (estado <> 'cancelada')
);
CREATE INDEX cita_por_medico_inicio ON cita (tenant_id, medico_id, lower(rango));

ALTER TABLE "consultorio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultorio" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "consultorio"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "medico" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medico" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "medico"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "tipo_cita" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tipo_cita" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tipo_cita"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "horario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "horario" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "horario"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "bloqueo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bloqueo" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bloqueo"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "cita" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cita" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cita"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL ON consultorio, medico, tipo_cita, horario, bloqueo, cita FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON consultorio, medico, tipo_cita, horario, bloqueo, cita TO "agenda_app";

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
GRANT SELECT, INSERT, UPDATE ON outbox, inbox TO "agenda_app";
REVOKE DELETE ON outbox, inbox FROM "agenda_app";
