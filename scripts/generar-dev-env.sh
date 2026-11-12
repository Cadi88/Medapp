#!/usr/bin/env bash
# Crea .env (ignorado por git) para el perfil `app` de docker compose si no existe:
# contraseñas locales de .env.example + secretos generados aquí (nunca se versionan).
# Si .env ya existe solo agrega las variables locales que falten. Para regenerar los secretos, borra .env y vuelve a ejecutar.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # Solo agrega las contraseñas locales de .env.example que falten (p. ej. las de un servicio nuevo); nunca toca lo existente.
  faltantes=0
  while IFS= read -r linea; do
    case "$linea" in
      [A-Z]*_PASSWORD=*|[A-Z]*_USER=*)
        if ! grep -q "^${linea%%=*}=" .env; then
          [ "$faltantes" -eq 0 ] && printf '\n# Agregado por scripts/generar-dev-env.sh\n' >> .env
          echo "$linea" >> .env
          faltantes=$((faltantes + 1))
        fi
        ;;
    esac
  done < .env.example
  echo ".env ya existe; se agregaron $faltantes variable(s) faltante(s)."
  exit 0
fi

# Llave de firma Ed25519 (JWK privado con kid) y secreto de Better Auth, generados con node:crypto.
SECRETOS=$(node --input-type=module -e "
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
const { privateKey } = generateKeyPairSync('ed25519');
const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'identidad-' + randomUUID().slice(0, 8) };
console.log('BETTER_AUTH_SECRET=' + randomBytes(48).toString('base64url'));
console.log(\"JWT_PRIVATE_JWK='\" + JSON.stringify(jwk) + \"'\");
")

umask 077
{
  cat .env.example
  echo
  echo "# Generado por scripts/generar-dev-env.sh"
  echo "$SECRETOS"
} > .env
echo ".env creado."
