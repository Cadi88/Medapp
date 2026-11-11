#!/usr/bin/env bash
# Crea .env (ignorado por git) para el perfil `app` de docker compose si no existe:
# contraseñas locales de .env.example + secretos generados aquí (nunca se versionan).
# Para regenerar los secretos, borra .env y vuelve a ejecutar.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env ya existe; no se modifica."
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
