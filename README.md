# Consultorio

SaaS multi-tenant para consultorios médicos. Monorepo pnpm + turbo (Node 24, TypeScript ESM):

- `apps/gateway`: punto de entrada único (JWT, rate limit, enrutamiento a los servicios).
- `apps/svc-identidad`: registro de consultorios, autenticación (Better Auth, MFA) y tokens de tenant.
- `apps/svc-auditoria`: bitácora de eventos con cadena hash por tenant.
- `packages/*`: contratos de eventos y plataforma compartida. `tests/e2e`: prueba de punta a punta de la fase 0.

## Ejecutar en local

Requisitos: Node 24, pnpm, Docker.

```bash
pnpm install
bash scripts/generar-dev-env.sh                  # una sola vez: crea .env con secretos aleatorios (no se versiona)
docker compose --profile app up -d --build --wait
```

El gateway queda en `http://localhost:8080` (rutas `/api/identidad/*` y `/api/auditoria/*`); es el único puerto
publicado de las aplicaciones. Sin `--profile app` solo se levanta la infraestructura (Postgres, NATS, MinIO).

`BETTER_AUTH_URL` (por defecto `http://localhost:8080`) es el origen público de la API: Better Auth rechaza los POST con
cookies cuya cabecera `Origin` no coincida, así que los clientes deben enviar ese origen.

## Producción

- `svc-identidad` solo debe ser alcanzable a través del gateway: confía en `x-forwarded-for` (que fija el gateway) para el límite
  de intentos de Better Auth por IP de cliente.
- En el gateway, `CONFIAR_EN_PROXY` debe ser el CIDR del balanceador de carga; si no, todos los clientes compartirían IP.

## Pruebas

```bash
pnpm test:unit                     # unitarias, sin Docker
pnpm test                          # unitarias + integración (Testcontainers) con umbral de cobertura
pnpm --filter @consultorio/e2e test  # E2E contra http://localhost:8080 (E2E_BASE_URL); requiere el perfil `app` arriba
pnpm lint && pnpm typecheck
```
