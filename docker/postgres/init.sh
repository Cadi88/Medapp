#!/bin/sh
# Ejecuta init.sql pasando las contraseñas del entorno como variables de psql.
# Para agregar un servicio: añadir sus variables aquí, en docker-compose.yml y .env.example.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v identidad_migrator_pw="$IDENTIDAD_MIGRATOR_PASSWORD" \
  -v identidad_app_pw="$IDENTIDAD_APP_PASSWORD" \
  -v auditoria_migrator_pw="$AUDITORIA_MIGRATOR_PASSWORD" \
  -v auditoria_app_pw="$AUDITORIA_APP_PASSWORD" \
  -f /sql/init.sql
