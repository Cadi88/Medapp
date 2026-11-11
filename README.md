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

## CI

El pipeline está en `.github/workflows/ci.yml`:

- `verificar` (PR y push a `main`): lint, typecheck y pruebas (unit + integración con Testcontainers). En PR solo lo afectado respecto a `origin/main`; en `main`, todo.
- `e2e`: levanta el stack con `docker compose --profile app` y corre `@consultorio/e2e`.
- `imagenes` y `desplegar` (solo `main`): construyen y publican las tres imágenes en ECR (tag = SHA y `latest`) y fuerzan un nuevo despliegue en ECS.

Configuración necesaria en GitHub para `imagenes` y `desplegar`:

- Variables de repositorio: `AWS_ROLE_ARN` (rol IAM asumido por OIDC) y `ECS_CLUSTER` (nombre del clúster ECS; los servicios se llaman como las apps).
- Environment `produccion` con revisores requeridos (aprobación manual del despliegue).

Mientras `AWS_ROLE_ARN` no esté definida, esos dos jobs se omiten.

## Infraestructura

`infra/` (`@consultorio/infra`) define la infraestructura de AWS con CDK en `mx-central-1`: `Consultorio-Red`
(VPC de 2 AZ, 1 NAT), `Consultorio-Datos` (KMS, RDS PostgreSQL 16, S3), `Consultorio-Mensajeria` (NATS con JetStream en
Fargate + EFS) y `Consultorio-Servicios` (ECR, ECS, ALB y secretos). El costo mensual estimado está al inicio de `infra/bin/app.ts`.

**Es solo código: no hay nada desplegado y no se ha ejecutado ningún comando contra AWS.** `cdk bootstrap` y `cdk deploy`
crean recursos que cuestan dinero (del orden de 200 USD/mes); no ejecutarlos antes de tener ingresos o presupuesto aprobado.
Lo siguiente es local y gratuito (no necesita credenciales de AWS):

```bash
pnpm --filter @consultorio/infra test                        # pruebas de aserciones sobre las plantillas
pnpm --filter @consultorio/infra exec cdk synth --quiet      # sintetiza las 4 stacks en infra/cdk.out (ignorado por git)
```

Requisitos para un despliegue futuro (quien despliegue, con su cuenta):

1. Cuenta de AWS con acceso habilitado a `mx-central-1` (región opt-in) y credenciales; exportar `CDK_DEFAULT_ACCOUNT`.
2. `cdk bootstrap aws://<cuenta>/mx-central-1` (crea el bucket y los roles de CDK).
3. Certificado ACM validado en `mx-central-1` para el dominio de la API: `cdk deploy --all -c certificadoArn=<arn> -c urlPublica=https://<dominio> -c imageTag=<sha>`.
   Sin `certificadoArn` el ALB escucha solo en HTTP:80 (válido únicamente para pruebas sin datos reales), y `urlPublica`
   (origen que acepta Better Auth) usa por defecto el DNS del balanceador. Apuntar el DNS del dominio al ALB.
4. Arranque manual de una sola vez (detallado en `infra/lib/servicios.ts`): crear en RDS las bases y roles como en
   `docker/postgres/init.sql` con las contraseñas de los secretos `consultorio/<rol>` de Secrets Manager, añadir a esos
   cuatro secretos el campo `url` con la cadena de conexión completa y reemplazar `consultorio/jwt-private-jwk` por la JWK privada.
5. Configurar en GitHub `AWS_ROLE_ARN` (rol OIDC con permisos sobre ECR y ECS) y `ECS_CLUSTER=consultorio` (ver CI). Los
   servicios ECS se llaman `gateway`, `svc-identidad` y `svc-auditoria` y sus repositorios `consultorio/<app>`.
6. Imágenes: los repositorios ECR tienen etiquetas inmutables y no existe `:latest`. El primer despliegue fija la imagen
   inicial con `-c imageTag=<sha>` (sin él, la stack exige el parámetro `ImageTag`), así que antes hay que publicar
   `consultorio/<app>:<sha>` de las tres apps. Después, el CI publica solo `:<sha>` y, tras la aprobación del environment
   `produccion`, registra una revisión nueva de cada definición de tarea con esa imagen y la asigna al servicio. Un
   `cdk deploy` posterior debe pasar el `imageTag` que esté en producción.

### Lista de verificación previa al primer despliegue

Pendientes conocidos de la revisión final de la fase 0. Ninguno impide sintetizar ni probar en local, pero todos deben
cerrarse (o aceptarse explícitamente) antes de poner datos reales en AWS:

- [x] **Imágenes aprobadas**: sin `:latest`, ECR inmutable y CI que registra revisiones con `:<sha>` tras la aprobación
      de `produccion` (paso 6).
- [ ] **TLS hacia RDS**: conectar con `sslmode=verify-full` y el bundle de CA de RDS (`global-bundle.pem`) en la imagen, y
      activar `rds.force_ssl` en el grupo de parámetros de PostgreSQL 16. Decidir también el TLS interno entre servicios
      (hoy HTTP plano dentro de la VPC por Service Connect).
- [ ] **Migraciones como tarea única**: hoy cada servicio corre `runMigrations` al arrancar con `MIGRATOR_DATABASE_URL`,
      así que las credenciales del migrador (dueño de las tablas) viven en los servicios en ejecución. Pasar a una tarea
      ECS de un solo uso (`run-task`) antes de cada despliegue y quitar ese secreto de las definiciones de tarea.
- [ ] **Fijar la versión de NATS**: `MensajeriaStack` usa `nats:2`; fijar una versión exacta (idealmente por digest).
- [ ] **Alerta de DLQ y script de replay**: alarma cuando el stream `DLQ` tenga mensajes y un script que reinyecte
      `dlq.<type>` en `evt.<type>` (el inbox hace idempotente el reproceso). Los errores de infraestructura ya no van a la
      DLQ salvo que la base esté caída más de 30 min.
- [ ] **`req.ip` detrás de Service Connect**: verificar en un entorno de prueba que el gateway ve la IP real del cliente
      (`CONFIAR_EN_PROXY` = CIDR de la VPC) y que identidad recibe el `x-forwarded-for` correcto; de ello dependen los
      límites por IP.
- [ ] **Telemetría real**: `initTelemetry` se llama después de importar `http`, `fastify` y `pg`, así que la
      instrumentación automática no los parchea. Cargar el SDK antes que la aplicación (`node --import ./dist/telemetria.js`)
      y configurar `OTEL_EXPORTER_OTLP_ENDPOINT`.
- [ ] **Imágenes de producción sin código de pruebas**: `pnpm deploy --prod` ya excluye las devDependencies, pero el
      `dist/` de `@consultorio/platform` incluye `testing/` (con Testcontainers como dependencia de producción) y la app
      desplegada lleva su `src/` y `test/` (no declara `files`); sacar `src/`, `test/` y `testing`/Testcontainers de las imágenes.

Notas de red: solo el ALB es público; `svc-identidad` y `svc-auditoria` solo aceptan tráfico del gateway (identidad confía en
`x-forwarded-for`), y `CONFIAR_EN_PROXY` del gateway es el CIDR de la VPC (`10.0.0.0/16`). `svc-auditoria` lee el JWKS por la ruta
pública del gateway (`/api/identidad/.well-known/jwks.json`) para no abrir identidad a otro origen. Con `CDK_DEFAULT_ACCOUNT`
definida la síntesis sigue sin consultar AWS (las zonas de disponibilidad están fijas en el código).
