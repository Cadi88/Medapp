#!/usr/bin/env bash
# Verifica que el entorno local (docker compose) esté sano. Falla ante cualquier problema.
set -u
cd "$(dirname "$0")/.."

ENV_FILE=.env
[ -f "$ENV_FILE" ] || ENV_FILE=.env.example
set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

fallos=0
fallar() { echo "FALLA: $1"; fallos=$((fallos + 1)); }
ok() { echo "OK: $1"; }

# 1. postgres, nats y minio healthy
estado=$(docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null)
for svc in postgres nats minio; do
  if echo "$estado" | tr -d '\r' | grep -qx "$svc healthy"; then ok "$svc healthy"; else fallar "$svc no está healthy"; fi
done

psql_app() {
  docker compose exec -T -e PGPASSWORD="$IDENTIDAD_APP_PASSWORD" postgres \
    psql -h 127.0.0.1 -U identidad_app -d identidad_db -tA -c "$1" 2>/dev/null | tr -d '\r'
}

# 2. identidad_app conecta a identidad_db
if [ "$(psql_app 'SELECT 1')" = "1" ]; then ok "identidad_app conecta a identidad_db"; else fallar "identidad_app no conecta a identidad_db"; fi

# 3. identidad_app sin BYPASSRLS
if [ "$(psql_app "SELECT rolbypassrls FROM pg_roles WHERE rolname='identidad_app'")" = "f" ]; then ok "identidad_app NOBYPASSRLS"; else fallar "identidad_app tiene BYPASSRLS o no existe"; fi

# 4. JetStream activo
if curl -s localhost:8222/jsz | grep -q '"config"'; then ok "JetStream activo"; else fallar "JetStream no activo"; fi

if [ "$fallos" -gt 0 ]; then echo "$fallos verificación(es) fallaron"; exit 1; fi
echo "Entorno OK"
