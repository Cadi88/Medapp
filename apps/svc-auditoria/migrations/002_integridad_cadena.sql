-- svc-auditoria: integridad del encabezado de la cadena (revisión final, F2). No modifica la 001 ya aplicada.

-- 1) fn_tenants_auditados también lista los tenants que tienen eventos pero no encabezado en `cadena`
--    (si alguien borrara o nunca creara la fila de cabeza, la verificación diaria igual los revisa).
--    FORCE RLS aplica al dueño: esta política (solo SELECT, solo el dueño) se activa únicamente con
--    app.listado_tenants = 'si', que fija la propia función mientras corre. El rol de aplicación nunca
--    coincide (no es el dueño), y el dueño sin ese parámetro sigue sin ver filas sin tenant.
CREATE POLICY evento_listado_dueno ON evento_auditoria FOR SELECT
  USING (
    current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.evento_auditoria'::regclass)
    AND current_setting('app.listado_tenants', true) = 'si'
  );

-- CREATE OR REPLACE conserva los privilegios de la 001 (EXECUTE solo para auditoria_app). Pasa a plpgsql/VOLATILE
-- porque fija el parámetro con set_config(..., true): PG16 no deja a un no superusuario declarar `SET app.x` en la
-- función. El parámetro se limpia al salir (y, por ser local, muere con la transacción aunque haya error); aunque
-- quedara puesto, la política exige además ser el dueño.
CREATE OR REPLACE FUNCTION fn_tenants_auditados()
RETURNS TABLE (tenant_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.listado_tenants', 'si', true);
  RETURN QUERY
    SELECT c.tenant_id FROM public.cadena c
    UNION
    SELECT DISTINCT e.tenant_id FROM public.evento_auditoria e
    ORDER BY 1;
  PERFORM set_config('app.listado_tenants', '', true);
END
$$;

-- 2) Defensa en profundidad: el encabezado solo nace en (0, génesis) y solo avanza de uno en uno hacia una fila
--    existente de evento_auditoria cuyo hash coincide. Impide "bajar la cabeza" (y con ello congelar la cadena:
--    los eventos nuevos chocarían con UNIQUE y la verificación seguiría diciendo "válida").
--    Corre como quien actualiza (SECURITY INVOKER): ve evento_auditoria con su mismo tenant (RLS).
CREATE FUNCTION fn_cadena_avance_valido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  h text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.ultima_secuencia <> 0 OR NEW.ultimo_hash <> repeat('0', 64) THEN
      RAISE EXCEPTION 'cadena: un encabezado nuevo debe empezar en 0 con el hash génesis' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'cadena: no se puede cambiar el tenant del encabezado' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.ultima_secuencia IS DISTINCT FROM OLD.ultima_secuencia + 1 THEN
    RAISE EXCEPTION 'cadena: la secuencia solo avanza de uno en uno (% -> %)', OLD.ultima_secuencia, NEW.ultima_secuencia
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT e.hash INTO h FROM evento_auditoria e WHERE e.tenant_id = NEW.tenant_id AND e.secuencia = NEW.ultima_secuencia;
  IF h IS NULL OR h IS DISTINCT FROM NEW.ultimo_hash THEN
    RAISE EXCEPTION 'cadena: ultimo_hash no coincide con el registro % de evento_auditoria', NEW.ultima_secuencia
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER cadena_avance_valido
  BEFORE INSERT OR UPDATE ON cadena
  FOR EACH ROW EXECUTE FUNCTION fn_cadena_avance_valido();
