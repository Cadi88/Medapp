-- Personalización del consultorio (Fase 1 entrega 2): marca, contacto, país y moneda.
-- tenant es global (sin RLS): el servicio filtra por el tenant del token.
-- Los consultorios existentes quedan como MX/MXN por los valores por omisión.

ALTER TABLE tenant
  ADD COLUMN nombre_comercial text CHECK (char_length(nombre_comercial) BETWEEN 2 AND 120),
  ADD COLUMN direccion text CHECK (char_length(direccion) <= 300),
  ADD COLUMN telefono text,
  ADD COLUMN color_primario text CHECK (color_primario ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN logo_key text,
  ADD COLUMN logo_version integer NOT NULL DEFAULT 0,
  ADD COLUMN pais text NOT NULL DEFAULT 'MX' CHECK (pais IN ('MX', 'BO')),
  ADD COLUMN moneda text NOT NULL DEFAULT 'MXN' CHECK (moneda IN ('MXN', 'BOB'));

-- identidad_app solo edita la personalización: nombre, slug, país, moneda y plan quedan fuera de su alcance.
-- Se retira primero el UPDATE de tabla completa (privilegios por omisión) y se concede por columna.
REVOKE UPDATE ON tenant FROM "identidad_app";
GRANT UPDATE (nombre_comercial, direccion, telefono, color_primario, logo_key, logo_version) ON tenant TO "identidad_app";
