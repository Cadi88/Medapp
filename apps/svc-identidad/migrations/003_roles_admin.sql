-- Modelo de roles de la Fase 1: rol de trabajo (medico | recepcion) + permiso admin independiente.
-- Los admins existentes pasan a medico + admin (el fundador de la Fase 0 era también el único médico).

ALTER TABLE membresia DROP CONSTRAINT membresia_rol_check;
ALTER TABLE membresia ADD COLUMN admin boolean NOT NULL DEFAULT false;
-- membresia tiene FORCE RLS incluso para el dueño y la migración no corre dentro de un tenant: se suspende
-- FORCE solo durante la conversión (misma transacción de la migración; el dueño no queda expuesto fuera de ella).
ALTER TABLE membresia NO FORCE ROW LEVEL SECURITY;
UPDATE membresia SET rol = 'medico', admin = true WHERE rol = 'admin';
ALTER TABLE membresia FORCE ROW LEVEL SECURITY;
ALTER TABLE membresia ADD CONSTRAINT membresia_rol_check CHECK (rol IN ('medico', 'recepcion'));

-- Cambia el tipo de retorno: se recrea la función (y sus permisos) con el permiso admin incluido.
DROP FUNCTION fn_membresias_usuario(uuid);
CREATE FUNCTION fn_membresias_usuario(p_usuario uuid)
RETURNS TABLE (tenant_id uuid, nombre text, slug text, rol text, admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.tenant_id, t.nombre, t.slug, m.rol, m.admin
  FROM membresia m JOIN tenant t ON t.id = m.tenant_id
  WHERE m.usuario_id = p_usuario
  ORDER BY t.nombre, m.tenant_id
$$;
REVOKE ALL ON FUNCTION fn_membresias_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_membresias_usuario(uuid) TO "identidad_app";
