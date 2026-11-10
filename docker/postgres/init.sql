-- Un bloque por servicio (copiar y cambiar el nombre). Variables :'<svc>_*_pw' vienen de init.sh.

-- ===== Servicio: identidad =====
CREATE ROLE identidad_migrator LOGIN PASSWORD :'identidad_migrator_pw';
CREATE ROLE identidad_app LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD :'identidad_app_pw';
CREATE DATABASE identidad_db OWNER identidad_migrator;
REVOKE ALL ON DATABASE identidad_db FROM PUBLIC;
GRANT CONNECT ON DATABASE identidad_db TO identidad_app;
\connect identidad_db
GRANT USAGE ON SCHEMA public TO identidad_app;
ALTER DEFAULT PRIVILEGES FOR ROLE identidad_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO identidad_app;
ALTER DEFAULT PRIVILEGES FOR ROLE identidad_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO identidad_app;
\connect postgres

-- ===== Servicio: auditoria =====
CREATE ROLE auditoria_migrator LOGIN PASSWORD :'auditoria_migrator_pw';
CREATE ROLE auditoria_app LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD :'auditoria_app_pw';
CREATE DATABASE auditoria_db OWNER auditoria_migrator;
REVOKE ALL ON DATABASE auditoria_db FROM PUBLIC;
GRANT CONNECT ON DATABASE auditoria_db TO auditoria_app;
\connect auditoria_db
GRANT USAGE ON SCHEMA public TO auditoria_app;
ALTER DEFAULT PRIVILEGES FOR ROLE auditoria_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auditoria_app;
ALTER DEFAULT PRIVILEGES FOR ROLE auditoria_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO auditoria_app;
\connect postgres

