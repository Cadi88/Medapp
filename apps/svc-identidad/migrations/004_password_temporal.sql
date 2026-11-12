-- Contraseña temporal: la cuenta creada por un admin debe cambiarla antes de obtener token de tenant.
-- "user" es global (sin RLS), no requiere rodeo de FORCE RLS.
ALTER TABLE "user" ADD COLUMN "debeCambiarPassword" boolean NOT NULL DEFAULT false;

-- Número de membresías del usuario en consultorios distintos de p_tenant. Sin tenant activo membresia es
-- invisible para identidad_app; la función SECURITY DEFINER (dueño: identidad_migrator) la lee por él.
CREATE FUNCTION fn_membresias_otros_consultorios(p_usuario uuid, p_tenant uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer FROM membresia WHERE usuario_id = p_usuario AND tenant_id <> p_tenant
$$;
REVOKE ALL ON FUNCTION fn_membresias_otros_consultorios(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_membresias_otros_consultorios(uuid, uuid) TO "identidad_app";
