-- Programador automático: lista de consultorios conocidos SIN tenant activo (recorre todos cada minuto).
-- consultorio tiene FORCE RLS: como en fn_envio_por_token, se da lectura al rol que ejecuta la migración (dueño de la
-- función SECURITY DEFINER); notificaciones_app solo llega a las filas vía la función (tenant_id y zona, sin contacto).
CREATE POLICY lectura_por_funcion_definer ON consultorio FOR SELECT TO CURRENT_USER USING (true);

CREATE FUNCTION fn_consultorios()
RETURNS TABLE (tenant_id uuid, zona_horaria text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.tenant_id, c.zona_horaria FROM consultorio c ORDER BY c.tenant_id
$$;
REVOKE ALL ON FUNCTION fn_consultorios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_consultorios() TO "notificaciones_app";
