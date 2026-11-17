# Consultorio

SaaS multi-tenant para consultorios médicos. Monorepo pnpm + turbo (Node 24, TypeScript ESM):

- `apps/gateway`: punto de entrada único (JWT, rate limit, enrutamiento a los servicios).
- `apps/svc-identidad`: registro de consultorios, autenticación (Better Auth, MFA) y tokens de tenant.
- `apps/svc-auditoria`: bitácora de eventos con cadena hash por tenant.
- `apps/svc-agenda`: médicos, horarios, tipos de cita, bloqueos y citas (puerto 3004, base `agenda_db`).
- `apps/svc-notificaciones`: recordatorios de cita por correo y WhatsApp, y respuestas del paciente (puerto 3005, base `notificaciones_db`).
- `apps/web`: sitio web del consultorio (Next.js, puerto 3000): registro, agenda, Mi día, Recordatorios, médicos, equipo, perfil y bitácora.
- `packages/*`: contratos de eventos y plataforma compartida. `tests/e2e`: E2E de API; `tests/e2e-web`: E2E de navegador (Playwright).

## Ejecutar en local

Requisitos: Node 24, pnpm, Docker.

```bash
pnpm install
bash scripts/generar-dev-env.sh                  # una sola vez: crea .env con secretos aleatorios (no se versiona)
docker compose --profile app up -d --build --wait
```

El sitio web queda en **`http://localhost:3000`** (abre `/registro` para crear un consultorio) y el gateway en
`http://localhost:8080` (rutas `/api/identidad/*`, `/api/auditoria/*`, `/api/agenda/*` y `/api/notificaciones/*`). Mailpit, el buzón donde caen los correos de los recordatorios, queda en **`http://localhost:8025`**. Sin `--profile app` solo se levanta la infraestructura (Postgres, NATS, MinIO).

El gateway confía como proxy solo en la IP fija del contenedor `web` (`CONFIAR_EN_PROXY=172.28.10.200/32`). En local un
cliente que llama directo a Next puede elegir su `X-Forwarded-For` (no hay proxy inverso delante): aceptado, solo local.

`BETTER_AUTH_URL` (por defecto `http://localhost:8080`) es el origen público de la API: Better Auth rechaza los POST con
cookies cuya cabecera `Origin` no coincida, así que los clientes deben enviar ese origen.

## Mi consultorio

La administración del consultorio abre **Mi consultorio** (`/consultorio`) para personalizarlo: nombre comercial, dirección,
teléfono (se guarda en formato E.164, p. ej. `+525512345678`), color del consultorio (con contraste suficiente contra el
blanco; los botones principales y el encabezado lo usan) y logo. El logo acepta PNG, JPG o WebP de hasta 1 MB; el servicio
lo reduce a PNG de máximo 512 px sin metadatos. Cada cambio queda en la bitácora (`consultorio.actualizado`). La recepción
y los médicos ven el logo y el color, pero no pueden cambiarlos.

El logo se guarda en un bucket S3 y solo se sirve a través de la aplicación (`/consultorio/logo`), nunca desde el almacenamiento.
**En local** es MinIO (el bucket se crea solo al arrancar `svc-identidad`); su consola está en `http://localhost:9001`
con `MINIO_ROOT_USER` y `MINIO_ROOT_PASSWORD` del `.env`. **En AWS** es el bucket `Archivos` de `Consultorio-Datos` (cifrado con KMS) y la
tarea de identidad solo puede leer, escribir y borrar `logos/*` con su rol, sin llaves.

Variables de `svc-identidad` (ya puestas en `docker-compose.yml` y en `infra/`):

| Variable | Local (MinIO) | AWS |
| --- | --- | --- |
| `S3_BUCKET` | `consultorio-archivos` | bucket `Archivos` |
| `S3_REGION` | `us-east-1` | `mx-central-1` |
| `S3_ENDPOINT` | `http://minio:9000` | no se define (S3 real) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `MINIO_ROOT_USER` y `MINIO_ROOT_PASSWORD` | no se definen (rol de la tarea) |

## Recordatorios

Cada cita con paciente puede recibir un recordatorio **el día anterior**, a la hora de envío del consultorio (por omisión
**10:00**, en la zona horaria del consultorio) y **todos los días de la semana, domingo incluido**. Va por correo (si la cita
tiene correo) y, además, la recepción puede abrir el mensaje de WhatsApp ya escrito desde la pantalla **Recordatorios**
(el envío por WhatsApp es siempre manual: se abre `wa.me` en una pestaña nueva, no se manda solo).

- **Modos** (en **Mi consultorio**, solo administración): *Con revisión* (por omisión: solo se envía lo que la recepción
  **aprobó** en **Recordatorios**, uno por uno o con "Aprobar todos") y *Sin revisión* (todo sale solo a la hora de envío).
  "Enviar ahora" adelanta un correo ya aprobado. Los correos fallidos se reintentan hasta 3 veces solo dentro de la corrida automática; un envío tras aprobar, "Enviar ahora" o "Reintentar" hace un solo intento y, si falla, muestra "No se pudo enviar".
- **Hora de envío y plantillas** (asunto, cuerpo del correo y WhatsApp) también se editan en **Mi consultorio**; los campos
  `{paciente}`, `{fecha}`, `{hora}`, `{medico}`, `{consultorio}` y `{telefono_consultorio}` se rellenan al enviar.
- **Respuesta del paciente**: el correo trae un enlace `/r/{token}` (página pública, sin sesión) para confirmar, cancelar o
  pedir cambio de horario. Abrir el enlace no responde por sí solo: hace falta elegir y pulsar "Enviar respuesta". El enlace es
  de un solo uso y vence al inicio de la cita; la respuesta llega a la agenda por un evento y cambia el estado de la cita.
- **Mi día** (`/mi-dia`) es la vista del médico para el celular: sus citas de hoy y las de los próximos días.

**En local** el correo sale a **Mailpit** (SMTP `mailpit:1025`, sin autenticación): ábrelo en `http://localhost:8025` para ver cada
mensaje y copiar el enlace de respuesta. Nunca sale un correo real desde el entorno local.

**Para el piloto en AWS** hace falta un servidor SMTP: elige un proveedor con capa gratuita (por ejemplo un servicio de correo
transaccional con cuota mensual sin costo; revisa que su límite alcance para tus citas) y **crea tú la cuenta**: este repositorio
no crea ninguna. Con los datos del proveedor completa el secreto `consultorio/smtp` de Secrets Manager (`host`, `port`,
`remitente`, `usuario` y `password`; con el puerto 587 se exige STARTTLS y con 465 TLS implícito). Después, en el DNS del dominio
del remitente, publica los registros **SPF** y **DKIM** que te indique el proveedor (y, si puedes, DMARC); sin ellos los
recordatorios acaban en spam.

Variables de `svc-notificaciones` (ya puestas en `docker-compose.yml` y en `infra/`):

| Variable | Local | AWS |
| --- | --- | --- |
| `PORT` | `3005` | `3005` |
| `DATABASE_URL`, `MIGRATOR_DATABASE_URL` | `notificaciones_app` / `notificaciones_migrator` en `notificaciones_db` | secretos `consultorio/notificaciones_app` y `_migrator` |
| `TOKEN_INTERNO` | del `.env` (≥ 32 caracteres); notificaciones lo usa para llamar a agenda e identidad | secreto `consultorio/token-interno` (compartido con agenda e identidad) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USUARIO`, `SMTP_PASSWORD`, `SMTP_REMITENTE` | `mailpit`, `1025`, sin usuario, `recordatorios@consultorio.local` | secreto `consultorio/smtp` |
| `WEB_ORIGEN` | `http://localhost:3000` | URL pública del sitio (los enlaces de los correos apuntan ahí) |
| `AGENDA_URL`, `IDENTIDAD_URL`, `JWKS_URL`, `NATS_URL` | red de compose | Service Connect |
| `S3_*` | MinIO (credenciales locales; el servicio solo lee `logos/*`) | rol de la tarea: `s3:GetObject` sobre `logos/*` y `kms:Decrypt` |

`TOKEN_INTERNO` protege las rutas `/interno/*` de agenda e identidad (cabecera `x-token-interno`); notificaciones no expone rutas internas y lo usa solo para llamarlas. El gateway
responde 404 a `/api/<servicio>/interno/*`, así que no se alcanzan desde internet. El gateway recibe además `NOTIFICACIONES_URL`.

## Producción

- `svc-identidad` solo debe ser alcanzable a través del gateway: confía en `x-forwarded-for` (que fija el gateway) para el límite
  de intentos de Better Auth por IP de cliente.
- En el gateway, `CONFIAR_EN_PROXY` debe ser el CIDR del balanceador de carga; si no, todos los clientes compartirían IP.

## Pruebas

```bash
pnpm test:unit                     # unitarias, sin Docker
pnpm test                          # unitarias + integración (Testcontainers) con umbral de cobertura
pnpm --filter @consultorio/e2e test  # E2E contra http://localhost:8080 (E2E_BASE_URL); requiere el perfil `app` arriba
pnpm --filter @consultorio/e2e-web exec playwright install chromium   # una sola vez (solo Chromium, gratis)
pnpm --filter @consultorio/e2e-web test  # E2E de navegador contra http://localhost:3000 (E2E_WEB_URL); requiere el perfil `app` arriba
pnpm lint && pnpm typecheck
```

## CI

El pipeline está en `.github/workflows/ci.yml`:

- `verificar` (PR y push a `main`): lint, typecheck y pruebas (unit + integración con Testcontainers). En PR solo lo afectado respecto a `origin/main`; en `main`, todo.
- `e2e`: levanta el stack con `docker compose --profile app` (incluye Mailpit, que no necesita configuración), corre `@consultorio/e2e` y después `@consultorio/e2e-web` (Playwright con Chromium; la prueba de recordatorios lee el correo en la API de Mailpit, `E2E_MAILPIT_URL`, por omisión `http://localhost:8025`); si falla, sube el reporte de Playwright como artefacto.
- `imagenes` y `desplegar` (solo `main`): construyen y publican las seis imágenes (gateway, svc-identidad, svc-auditoria, svc-agenda, svc-notificaciones y web) en ECR solo con tag = SHA (sin `latest`) y registran una revisión nueva de la tarea en ECS.

Configuración necesaria en GitHub para `imagenes` y `desplegar`:

- Variables de repositorio: `AWS_ROLE_ARN` (rol IAM asumido por OIDC) y `ECS_CLUSTER` (nombre del clúster ECS; los servicios se llaman como las apps).
- Environment `produccion` con revisores requeridos (aprobación manual del despliegue).

Mientras `AWS_ROLE_ARN` no esté definida, esos dos jobs se omiten.

## Infraestructura

`infra/` (`@consultorio/infra`) define la infraestructura de AWS con CDK en `mx-central-1`: `Consultorio-Red`
(VPC de 2 AZ, 1 NAT), `Consultorio-Datos` (KMS, RDS PostgreSQL 16, S3), `Consultorio-Mensajeria` (NATS con JetStream en
Fargate + EFS) y `Consultorio-Servicios` (ECR, ECS, ALB y secretos). El ALB envía `/` al sitio `web` y `/api/*` al gateway;
`agenda_db` y `notificaciones_db` viven en la misma instancia RDS. El costo mensual estimado está al inicio de `infra/bin/app.ts`.

**Es solo código: no hay nada desplegado y no se ha ejecutado ningún comando contra AWS.** `cdk bootstrap` y `cdk deploy`
crean recursos que cuestan dinero (unos 245 USD/mes según la estimación de `infra/bin/app.ts`; 400-450 USD/mes con
alta disponibilidad); no ejecutarlos antes de tener ingresos o presupuesto aprobado.
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
   ocho secretos (identidad, auditoría, agenda y notificaciones: `_app` y `_migrator`) el campo `url` con la cadena de conexión completa, reemplazar `consultorio/jwt-private-jwk` por la JWK privada y completar `consultorio/smtp` con los datos del proveedor de correo (ver Recordatorios).
5. Configurar en GitHub `AWS_ROLE_ARN` (rol OIDC con permisos sobre ECR y ECS) y `ECS_CLUSTER=consultorio` (ver CI). Los
   servicios ECS se llaman `gateway`, `svc-identidad`, `svc-auditoria`, `svc-agenda`, `svc-notificaciones` y `web` y sus repositorios `consultorio/<app>`.
6. Imágenes: los repositorios ECR tienen etiquetas inmutables y no existe `:latest`. El primer despliegue fija la imagen
   inicial con `-c imageTag=<sha>` (sin él, la stack exige el parámetro `ImageTag`), así que antes hay que publicar
   `consultorio/<app>:<sha>` de las seis apps (el sitio `web` se construye con `docker/Dockerfile.web`). Después, el CI publica solo `:<sha>` y, tras la aprobación del environment
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
- [ ] **Proxy inverso delante de `web`**: poner un proxy inverso que agregue `X-Forwarded-For` delante de `web` (el ALB).
      El sitio reenvía al gateway solo el último salto de esa cabecera y el gateway confía únicamente en la IP de `web`;
      sin ese proxy, un cliente que llega directo a Next elige su IP (y con ella los límites por IP). En desarrollo local
      ocurre así (se llega a Next sin proxy): aceptado, solo local.
- [ ] **Telemetría real**: `initTelemetry` se llama después de importar `http`, `fastify` y `pg`, así que la
      instrumentación automática no los parchea. Cargar el SDK antes que la aplicación (`node --import ./dist/telemetria.js`)
      y configurar `OTEL_EXPORTER_OTLP_ENDPOINT`.
- [ ] **Imágenes de producción sin código de pruebas**: `pnpm deploy --prod` ya excluye las devDependencies, pero el
      `dist/` de `@consultorio/platform` incluye `testing/` (con Testcontainers como dependencia de producción) y la app
      desplegada lleva su `src/` y `test/` (no declara `files`); sacar `src/`, `test/` y `testing`/Testcontainers de las imágenes.
- [ ] **Orden de despliegue de la personalización del consultorio**: desplegar en este orden: `svc-agenda` (acepta
      `tenant.creado` v2) → `svc-identidad` → gateway (límite de 2 MB en `PUT /consultorio/logo`) → `web` (su
      `consultorioSchema` exige los campos nuevos, así que antes de identidad fallaría al leer el consultorio).

- [ ] **Orden de despliegue de los recordatorios**: desplegar en este orden: `svc-agenda` (rutas `/interno/*` y eventos de
      respuesta) → `svc-identidad` (ruta interna `consultorio-para-mensaje`) → `svc-notificaciones` (crea su base y consume los eventos) →
      gateway (`NOTIFICACIONES_URL`) → `web` (pantallas Recordatorios, Mi día y `/r/{token}`). Antes, crear `notificaciones_db`
      con sus roles y completar los secretos `consultorio/smtp` y `consultorio/token-interno` (este último se genera solo, pero
      agenda e identidad lo leen al arrancar: sin él no inician).

Variables nuevas (compose y CDK): `web` usa `GATEWAY_URL` (por defecto `http://gateway:8080`), `COOKIE_SEGURA` (`true` con HTTPS) y
`WEB_ORIGEN` (origen público del sitio); `svc-identidad` recibe `ORIGENES_CONFIABLES` con ese mismo origen y el gateway `AGENDA_URL` y `NOTIFICACIONES_URL`.
`TOKEN_INTERNO` (secreto `consultorio/token-interno`) llega a agenda, identidad y notificaciones; ver Recordatorios.

Notas de red: solo el ALB es público; `svc-identidad`, `svc-auditoria`, `svc-agenda` y `svc-notificaciones` solo aceptan tráfico del gateway (identidad confía en
`x-forwarded-for`; agenda e identidad aceptan además a notificaciones en sus rutas `/interno/*`), y `CONFIAR_EN_PROXY` del gateway es el CIDR de la VPC (`10.0.0.0/16`). `svc-auditoria`, `svc-agenda` y `svc-notificaciones` leen el JWKS por la ruta
pública del gateway (`/api/identidad/.well-known/jwks.json`) para no abrir identidad a otro origen. Con `CDK_DEFAULT_ACCOUNT`
definida la síntesis sigue sin consultar AWS (las zonas de disponibilidad están fijas en el código).
