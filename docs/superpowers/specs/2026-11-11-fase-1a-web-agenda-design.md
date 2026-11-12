# Fase 1 · Entrega 1 — Sitio web del consultorio + agenda interna

**Fecha:** 2026-11-11
**Estado:** borrador para revisión
**Base:** [Diseño general](2026-11-10-saas-consultorios-design.md) y la Fase 0 implementada en `main`.

---

## 1. Contexto y objetivo

La Fase 1 del diseño general (Agenda) se divide en tres entregas, cada una con su propio ciclo de spec → plan → implementación:

| Entrega | Contenido |
|---|---|
| **1 (esta)** | Sitio web del consultorio + agenda interna (citas creadas por el personal) |
| 2 | Página pública de reserva para pacientes |
| 3 | Recordatorios y confirmaciones (email, WhatsApp, SMS) |

**Objetivo:** tener un producto visible que un consultorio piloto pueda usar a diario para manejar su agenda.

**Restricciones:**
- Costo de infraestructura $0 antes de monetizar: todo corre local con `docker compose`. Nada se despliega en la nube.
- Desarrollador único en TypeScript.
- Se mantienen las decisiones del diseño general: microservicios, una base por servicio, RLS por tenant, outbox → NATS JetStream y contratos Zod en `packages/contracts`.

**Criterios de éxito:**
1. Un médico registra su consultorio, activa MFA, configura su horario y tipos de cita, y agenda, reprograma y cancela citas desde el navegador.
2. El admin da de alta a una recepcionista con contraseña temporal. Ella entra, cambia la contraseña y maneja la agenda de todos los médicos.
3. Es imposible reservar dos citas encimadas para el mismo médico, incluso con peticiones simultáneas.
4. El admin ve en la bitácora quién hizo cada acción.
5. Todas las pruebas pasan, con cobertura ≥ 80% de líneas y ramas en cada paquete, y la E2E de navegador está en verde.

---

## 2. Cambios en identidad (Fase 0)

### 2.1 Rol de trabajo + permiso de administrador

**Problema:** hoy `membresia.rol ∈ {admin, medico, recepcion}`. El médico que registra su consultorio queda como `admin` y no puede aparecer en la agenda como médico.

**Decisión:** el rol describe el trabajo y la administración es un permiso aparte.

- `membresia.rol ∈ {medico, recepcion}` y `membresia.admin boolean NOT NULL DEFAULT false`.
- **Registro:** se pregunta "¿eres médico?" (`esMedico: boolean`). El fundador queda con `rol = esMedico ? 'medico' : 'recepcion'` y `admin = true`.
- **Migración 003:** las membresías con `rol = 'admin'` pasan a `rol = 'medico', admin = true`. No hay datos reales, así que no hace falta preservar más.
- **Claims del JWT del tenant:** `{ sub, tid, rol: 'medico'|'recepcion', admin: boolean, mfa: boolean }`.
- **`packages/platform`:** `requireRole(...roles)` se mantiene para roles de trabajo y se agrega `requireAdmin()`. Las rutas que hoy usan `requireRole('admin')` pasan a `requireAdmin()`.
- **MFA obligatorio** si `rol = 'medico'` o `admin = true` (`decidirToken`).
- **Invariante "siempre un admin":** no se permite quitar la última membresía con `admin = true`, ya sea con `DELETE /miembros/:id` o con `PATCH /miembros/:id` (`admin: false`). Se cuentan los admins con las filas bloqueadas (`FOR UPDATE`), igual que hoy.

### 2.2 Contraseña temporal

- Se agrega el campo de usuario `debeCambiarPassword boolean NOT NULL DEFAULT false` (campo adicional de Better Auth).
- `POST /miembros`, cuando crea una cuenta nueva, y `POST /miembros/:id/password-temporal` dejan `debeCambiarPassword = true`.
- `POST /sesion/tenant` responde `403 PASSWORD_TEMPORAL` (nuevo `ErrorCode`) mientras `debeCambiarPassword = true`.
- Tras un cambio de contraseña exitoso (`/auth/change-password` de Better Auth), un hook pone `debeCambiarPassword = false` y revoca las demás sesiones del usuario.
- `POST /miembros/:id/password-temporal` (solo admin) solo aplica a usuarios que pertenecen a este consultorio. Si el usuario también pertenece a otro consultorio, se rechaza con `409 CONFLICTO`: un admin no puede cambiar la contraseña de una cuenta compartida con otro consultorio. Revoca las sesiones del usuario.

### 2.3 Endpoints nuevos de identidad

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /consultorio` | cualquier miembro | `{ id, nombre, slug, zonaHoraria }` |
| `GET /miembros` | cualquier miembro | `[{ usuarioId, nombre, email, rol, admin, mfaActivo, perfilMedico? }]` |
| `PATCH /miembros/:usuarioId` | admin | `{ rol?, admin? }` y respeta "siempre un admin". Si el rol deja de ser `medico`, el perfil médico se conserva pero agenda marca al médico inactivo. |
| `POST /miembros/:usuarioId/password-temporal` | admin | `{ passwordTemporal }` (ver §2.2) |

`POST /miembros` cambia su cuerpo a `{ nombre, email, rol: 'medico'|'recepcion', admin: boolean, passwordTemporal }`.

### 2.4 Eventos de identidad

| Evento | Versión | Datos |
|---|---|---|
| `usuario.vinculado` | **2** | `{ usuarioId, nombre, rol, admin }` |
| `miembro.actualizado` | 1 (nuevo) | `{ usuarioId, nombre, rol, admin }`: se emite en `PATCH /miembros` (no hay edición de nombre en esta entrega) |
| `tenant.creado` | 1 | sin cambios |
| `usuario.desvinculado` | 1 | sin cambios |
| `medico.actualizado` | 1 | sin cambios |

Los consumidores existentes (auditoría) aceptan `usuario.vinculado` v1 y v2. El productor emite solo v2.

### 2.5 Bitácora

`GET /auditoria/eventos` (solo admin) gana paginación por cursor (`?antesDe=<id>&limite=50`) y filtros `desde`, `hasta` y `accion`. La respuesta incluye `actorId`, y el sitio web resuelve el nombre con `GET /miembros`.

---

## 3. `svc-agenda` (servicio nuevo)

Sigue el patrón de la Fase 0: Fastify 5, `createHttpApp`, `platformPlugin`, `agenda_db` con roles `agenda_migrator` y `agenda_app` (NOBYPASSRLS), RLS con la política estándar en **todas** las tablas, outbox e inbox, migraciones con `db/migrate`.

### 3.1 Datos

| Tabla | Campos clave | Restricciones |
|---|---|---|
| `consultorio` | tenant_id (PK), zona_horaria | Se llena con `tenant.creado` |
| `medico` | tenant_id, usuario_id (PK compuesta), nombre, activo | Read model alimentado por eventos de identidad. Nunca se borra. |
| `tipo_cita` | id, tenant_id, medico_id, nombre, duracion_min, activo | `CHECK (duracion_min BETWEEN 5 AND 480)`, nombre único por médico entre los activos |
| `horario` | id, tenant_id, medico_id, dia_semana (0–6, 0 = domingo), hora_inicio, hora_fin (`time`, hora local) | `CHECK (hora_inicio < hora_fin)`; sin encimarse por médico y día (`EXCLUDE` sobre rango de minutos) |
| `bloqueo` | id, tenant_id, medico_id, rango (`tstzrange`), motivo | `CHECK (NOT isempty(rango))` |
| `cita` | id, tenant_id, medico_id, tipo_cita_id, rango (`tstzrange`), estado, contacto_nombre, contacto_telefono, contacto_email (nullable), notas (nullable), fuera_de_horario boolean, origen (`recepcion`), creada_por, version int | `EXCLUDE USING gist (tenant_id WITH =, medico_id WITH =, rango WITH &&) WHERE (estado <> 'cancelada')` (extensión `btree_gist`) |

Todas las fechas se guardan en UTC (`timestamptz`) y los ids son UUIDv7. `origen` admite solo `recepcion` en esta entrega. La entrega 2 agrega `reserva_publica`.

### 3.2 Reglas de dominio (funciones puras, sin I/O)

- **Transiciones de estado** (`transicionPermitida(de, a)`):
  - `agendada → confirmada | cancelada | no_asistio | atendida`
  - `confirmada → atendida | cancelada | no_asistio`
  - `atendida`, `cancelada` y `no_asistio` son finales.
- **Reprogramar** solo desde `agendada` o `confirmada`. La cita vuelve a `agendada`. Se puede cambiar el rango, el tipo y el médico.
- **Encaje en horario** (`encajaEnHorario(rango, horario, zona)`): el rango completo cae dentro de un bloque del horario del día local. Si no cae, la petición falla con `422 FUERA_DE_HORARIO`, salvo que traiga `fueraDeHorario: true` (permitido a recepción, admin y al propio médico). En ese caso se guarda `fuera_de_horario = true`.
- **Bloqueos:** una cita nunca puede encimarse con un bloqueo (`409 HORARIO_BLOQUEADO`). Esto no se puede forzar.
- **Doble reserva:** la garantiza la base de datos. La violación del `EXCLUDE` se traduce a `409 HORARIO_OCUPADO`.
- **Duración:** `rango.fin = rango.inicio + tipo_cita.duracion_min`. El cliente envía solo `inicio`.
- **Huecos libres** (`huecosLibres(fecha, horario, bloqueos, citas, duracion, zona)`): los inicios posibles cada `duracion_min` dentro de cada bloque del horario, sin encimarse con citas activas ni bloqueos, y nunca en el pasado.
- **Zonas horarias:** el horario está en hora local del consultorio. Las conversiones usan la zona IANA con Luxon. Los días con cambio de horario (zonas fronterizas) se prueban explícitamente.
- **Concurrencia de edición:** `PATCH` y `POST /estado` exigen `version`. Si no coincide, responden `409 CONFLICTO_VERSION` y cada escritura incrementa `version`.
- **Médico inactivo:** no se le pueden crear citas nuevas. Sus citas existentes se conservan.

### 3.3 Permisos

| Acción | Admin | Recepción | Médico |
|---|---|---|---|
| Ver y gestionar agenda, horario, tipos y bloqueos de **cualquier** médico | ✅ | ✅ | ❌ |
| Ver y gestionar los **propios** | ✅ | n/a | ✅ |

Si un médico pide recursos de otro médico, recibe `403 PROHIBIDO`. La regla vive en una función pura `puedeGestionarMedico(claims, medicoId)`. Al reprogramar con cambio de médico, la regla se evalúa sobre el médico de origen **y** el de destino, así que un médico no puede pasar citas a otro. Un recurso de otro tenant o inexistente responde `404 NO_ENCONTRADO` (RLS lo hace invisible).

### 3.4 API (prefijo `/api/agenda` vía gateway)

| Método y ruta | Descripción |
|---|---|
| `GET /medicos` | Médicos activos que el usuario puede ver |
| `GET /medicos/:id/tipos-cita` · `POST` · `PATCH /medicos/:id/tipos-cita/:tipoId` | Alta, edición y desactivación |
| `GET /medicos/:id/horario` · `PUT` | El `PUT` reemplaza la semana completa en una transacción |
| `GET /medicos/:id/bloqueos?desde&hasta` · `POST` · `DELETE /medicos/:id/bloqueos/:bloqueoId` | |
| `GET /medicos/:id/disponibilidad?fecha=YYYY-MM-DD&tipoCitaId=` | Huecos libres del día (§3.2) |
| `GET /citas?desde&hasta&medicoId=` | Máximo 31 días por consulta |
| `POST /citas` | `{ medicoId, tipoCitaId, inicio, contacto: { nombre, telefono, email? }, notas?, fueraDeHorario? }` |
| `PATCH /citas/:id` | Reprogramar: `{ version, inicio, tipoCitaId?, medicoId?, fueraDeHorario? }` |
| `POST /citas/:id/estado` | `{ version, estado }` |

Las entradas se validan con Zod. Los esquemas de petición y respuesta viven en `packages/contracts/src/api/agenda.ts`.

### 3.5 Eventos

**Publica** (en `packages/contracts/src/events/agenda.ts`):

| Evento | Datos |
|---|---|
| `cita.creada` | `{ citaId, medicoId, tipoCitaId, inicio, fin, estado, origen, fueraDeHorario }` |
| `cita.reprogramada` | `{ citaId, medicoId, inicio, fin, anterior: { medicoId, inicio, fin } }` |
| `cita.cancelada` | `{ citaId, medicoId, inicio, fin }` |
| `cita.estado_cambiado` | `{ citaId, de, a }`: confirmada, atendida, no_asistio |

Los eventos **no incluyen datos de contacto** (teléfono, email, nombre del paciente), para minimizar la dispersión de datos personales. La entrega 3 definirá cómo obtiene el contacto el servicio de notificaciones.

**Consume:** `tenant.creado` (crea `consultorio`), `usuario.vinculado` v1 y v2 (si `rol = medico`, crea o activa el `medico`), `miembro.actualizado` (actualiza el nombre y activa o desactiva según el rol) y `usuario.desvinculado` (desactiva). Los consumidores son idempotentes vía inbox.

Auditoría ya consume todos los eventos, así que las acciones de agenda aparecen en la bitácora sin cambios en ese servicio, salvo aceptar los nuevos tipos.

---

## 4. Sitio web (`apps/web`)

### 4.1 Tecnología
Next.js (App Router), React y TypeScript estricto, Tailwind CSS y componentes shadcn/ui (copiados al repo), FullCalendar (paquetes MIT: `core`, `react`, `timegrid`, `daygrid`, `interaction`, `list`) y Luxon para fechas. Los componentes viven en `apps/web`. No se crea `packages/ui` hasta que exista un segundo frontend.

### 4.2 Sesión: Next.js como intermediario
- El navegador habla **solo** con Next.js. Next llama al gateway desde el servidor por la red interna.
- **Cookies httpOnly, `Secure` (en producción), `SameSite=Lax`:**
  - `sesion`: la cookie de Better Auth. Next la reenvía al gateway solo en rutas de identidad, igual que hoy.
  - `token_consultorio`: el JWT del tenant (15 min).
- **Login:** `POST /auth/sign-in/email` → (si hay 2FA) verificación TOTP → `GET /tenants/mios` → si hay uno, se elige solo; si hay varios, `/elegir-consultorio` → `POST /sesion/tenant`.
- **Renovación:** el `proxy` de Next (antes `middleware`) corre antes de cada petición; si al JWT le quedan menos de 60 s, pide uno nuevo con la sesión y lo escribe en la cookie (los Server Components no pueden escribir cookies).
- **Desvíos:** `PASSWORD_TEMPORAL` → `/cambiar-password`. `MFA_REQUERIDA` → `/configurar-mfa`. `401` → `/login`.
- **CSRF:** las *server actions* de Next ya verifican `Origin`. No hay rutas de mutación fuera de server actions.
- **IP real:** Next reenvía `X-Forwarded-For` con la IP del cliente. El gateway incluye la IP del contenedor web en `trustProxy`.

### 4.3 Organización del código
```
apps/web/src/
  app/                 Rutas: solo componen pantallas (delgadas)
  features/<área>/     agenda, equipo, horario, perfil, bitacora, sesion
    components/        Componentes de React
    actions.ts         Server actions del área
    logica/            Funciones puras (formato, armado de eventos del calendario, validaciones de formulario)
  lib/api/             Cliente del gateway (import 'server-only'); valida respuestas con packages/contracts
  lib/sesion/          Cookies, renovación del token, desvíos
  components/ui/       Componentes shadcn/ui
```
Las pantallas cargan datos en Server Components. Las mutaciones usan server actions que luego llaman a `revalidatePath`.

### 4.4 Pantallas

| Ruta | Acceso | Contenido |
|---|---|---|
| `/registro` | Público | Nombre del consultorio, slug, zona horaria, "¿eres médico?" y datos del admin; después lleva a `/configurar-mfa` |
| `/login`, `/login/mfa` | Público | Email y contraseña; código TOTP |
| `/cambiar-password`, `/configurar-mfa`, `/elegir-consultorio` | Con sesión | Flujo de entrada |
| `/agenda` | Miembros | FullCalendar en vista de día y semana; filtro por médico (admin y recepción); crear cita (médico → tipo → hueco sugerido → contacto); detalle con acciones de estado; reprogramar arrastrando o con formulario. Por debajo de 768 px, vista de lista del día. |
| `/medicos/[id]` | Admin, recepción, el propio médico | Horario semanal, tipos de cita y bloqueos |
| `/equipo` | Admin | Lista; alta con contraseña temporal; cambiar rol y admin; reiniciar contraseña; quitar |
| `/perfil` | Miembros | Perfil médico (si aplica) y cambio de contraseña |
| `/bitacora` | Admin | Tabla paginada con filtros por fecha y acción |

Interfaz en español; fechas en `es-MX` y en la zona horaria del consultorio.

### 4.5 Manejo de errores en la interfaz

| Respuesta | Comportamiento |
|---|---|
| `409 HORARIO_OCUPADO` | "Ese horario ya se ocupó, elige otro" y se recarga la disponibilidad |
| `409 HORARIO_BLOQUEADO` | "El médico tiene ese horario bloqueado" |
| `422 FUERA_DE_HORARIO` | Ofrece "Agendar de todos modos" (reenvía con `fueraDeHorario: true`) |
| `409 CONFLICTO_VERSION` | "Alguien modificó esta cita" y se recarga |
| `400 VALIDACION` | Errores junto a cada campo |
| `403 PROHIBIDO` | Página "No tienes acceso" |
| Error 5xx o de red | Aviso genérico con opción de reintentar; nunca se muestran detalles internos |

---

## 5. Integración

- **Gateway:** `SERVICIOS` agrega `agenda`. Todas las rutas de agenda son protegidas (JWT). Rate limit igual que el resto.
- **Contratos:** los nuevos `ErrorCode` (`PASSWORD_TEMPORAL`, `FUERA_DE_HORARIO`, `HORARIO_OCUPADO`, `HORARIO_BLOQUEADO`, `CONFLICTO_VERSION`) y los esquemas de API y eventos se agregan a `packages/contracts`.
- **Docker:**
  - `docker/postgres/init.sql` crea `agenda_db` y sus roles.
  - El perfil `app` suma `svc-agenda` (reutiliza `docker/Dockerfile.service`) y `web` (`docker/Dockerfile.web`: Next `output: 'standalone'`, `node:24-slim`, sin root, `HEALTHCHECK`) en el puerto 3000.
  - `scripts/generar-dev-env.sh` agrega las variables nuevas.
- **Infra (solo código, sin desplegar, $0):** `infra/` agrega `svc-agenda` y `web` al stack de servicios y `agenda_db` al de datos, con sus pruebas de CDK.
- **CI:** los jobs existentes cubren los paquetes nuevos. La E2E de navegador (Playwright) entra al job `e2e`.

---

## 6. Pruebas

| Nivel | Alcance | Herramientas |
|---|---|---|
| Unitarias | Reglas de agenda (§3.2), permisos (§3.3), cambios de identidad (`decidirToken`, "siempre un admin", contraseña temporal), cliente de API y lógica pura del sitio web, componentes de React | Vitest; Testing Library + jsdom en `apps/web` |
| Integración | Agenda con PostgreSQL real: RLS entre tenants en cada tabla; `EXCLUDE` con **dos inserciones concurrentes** donde gana solo una; horario sin encimarse; outbox e inbox; consumo idempotente de los eventos de identidad. Identidad: migración 003, nuevos endpoints, invariantes de admin bajo concurrencia | Vitest + Testcontainers |
| E2E de API | Se extiende `tests/e2e`: flujo de agenda vía gateway; auditoría registra `cita.*` | Vitest |
| E2E de navegador | Registro → MFA → horario y tipo → crear cita → reprogramar → cancelar → bitácora. Recepción no entra a `/equipo`. Un médico no ve las citas de otro. Contraseña temporal obliga a cambiarla. | Playwright contra `docker compose --profile app` |

Cobertura mínima de **80% en líneas y ramas** por paquete, incluido `apps/web`. Si no se cumple, el build falla. Se mantiene la convención de scripts (`test`, `test:unit`, `test:integration`).

---

## 7. Principios de mantenibilidad (requisitos verificables)

1. **Capas:** cada servicio separa `dominio/` (funciones puras), `rutas/` (HTTP) y `datos/` (SQL). Una regla de ESLint prohíbe que `dominio/` importe `pg`, `fastify`, `nats` o `@consultorio/platform`.
2. **Inversión de dependencias:** el reloj, los generadores de ids y los clientes externos se inyectan al construir el servidor (`buildServer(deps)`). Las pruebas usan dobles.
3. **ACID dentro de cada servicio:** toda escritura va en `withTenant` (una transacción). El evento se escribe en el outbox dentro de la misma transacción. Las invariantes críticas se garantizan en la base de datos (`EXCLUDE`, `CHECK`, FK, `UNIQUE`), no solo en código.
4. **Consistencia eventual entre servicios, explícita:** sin transacciones distribuidas. Los consumidores son idempotentes (inbox) y hay DLQ para los fallos permanentes.
5. **TDD:** cada regla de §3.2, §3.3 y §2 tiene pruebas unitarias escritas antes que el código. Cobertura ≥ 80%.
6. **Tipado estricto:** TypeScript `strict`, sin `any` (ESLint `no-explicit-any` como error), archivos con un solo propósito (guía: menos de 300 líneas).
7. **Contratos versionados:** un cambio incompatible en un evento crea una versión nueva, y los consumidores aceptan ambas durante la transición (§2.4).
8. **Límites entre apps:** se mantiene la regla de ESLint que impide importar de otra `apps/*`.

---

## 8. Fuera de alcance

Reserva pública (entrega 2); recordatorios, correos y WhatsApp (entrega 3); pacientes y expediente (Fase 2); cobros (Fase 3); citas recurrentes; salas o equipos como recurso; varias sucursales; app móvil nativa; sincronización con Google Calendar; invitaciones por correo; recuperación de contraseña por correo (el admin la reinicia, §2.2).

---

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Next.js agrega complejidad de despliegue | Imagen standalone en el mismo `docker compose`; un solo contenedor más |
| Errores de zona horaria | Funciones puras con pruebas en `America/Mexico_City` y `America/Tijuana`, incluidos los días de cambio de horario |
| El cambio de roles rompe la Fase 0 | La migración y las pruebas existentes se actualizan en la misma tarea; la E2E de la Fase 0 debe seguir en verde |
| FullCalendar no cubre algún caso | Envuelto en un componente propio (`features/agenda/components/Calendario`), así que se puede reemplazar sin tocar el resto |
| Recuperación de contraseña sin correo | El admin reinicia la contraseña; el correo llega en la entrega 3 |
