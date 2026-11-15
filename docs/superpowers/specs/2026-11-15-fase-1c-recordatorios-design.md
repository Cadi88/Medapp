# Fase 1 · Entrega 3 — Recordatorios a pacientes y "Mi día"

**Fecha:** 2026-11-15
**Estado:** borrador para revisión
**Base:** [Diseño general](2026-11-10-saas-consultorios-design.md) (§2.2, §3.6, §5.1), [entrega 1](2026-11-11-fase-1a-web-agenda-design.md) y [entrega 2](2026-11-12-fase-1b-personalizacion-design.md), integradas en `main`.

---

## 1. Intención

El paciente llama, el asistente agenda la cita y **el día anterior el paciente recibe un recordatorio automático** para confirmar, cancelar o pedir un cambio. Así bajan las inasistencias y recepción sabe con tiempo quién viene. El día de la consulta, el médico ve en **"Mi día"** sus citas en orden y con su estado.

La app sigue siendo de uso privado: el paciente nunca entra a la app. Su único contacto es el mensaje y, si llega por correo, una página mínima para responder.

**Decisiones del dueño (2026-11-15):**
- **Todo el envío es automático**, también en fin de semana: cada recordatorio sale a la hora configurada del día anterior a la cita.
- **Revisión por adelantado mientras se afina el formato:** en el modo inicial ("con revisión"), la persona encargada revisa y aprueba con anticipación (p. ej., el viernes o sábado los recordatorios que saldrán el domingo). Solo lo aprobado se envía. Cuando el consultorio esté a gusto con el formato, el administrador activa el modo "sin revisión".
- Canales con costo $0: **correo automático** y **WhatsApp asistido** (para pacientes sin correo; lo envía una persona). El WhatsApp automático (API de Meta, con costo por mensaje) llega al monetizar, sin rehacer nada.

**Criterios de éxito:**
1. Los recordatorios por correo salen solos a la hora configurada del día anterior, incluido el domingo, sin que nadie esté conectado.
2. En modo "con revisión", la encargada ve los recordatorios de los próximos días con su vista previa y los aprueba uno por uno o todos; lo no aprobado no sale y queda marcado.
3. El paciente que recibe el correo confirma, cancela o pide cambio desde su teléfono, sin cuenta, y la cita cambia de estado sola.
4. El administrador ajusta los textos con vista previa, la hora de envío y el modo.
5. El médico abre "Mi día" en su celular y ve sus citas de hoy con su estado, y las próximas pendientes de confirmar.
6. Ningún dato de contacto del paciente viaja en eventos ni queda en la bitácora; un enlace de respuesta no sirve dos veces ni da acceso a nada más.
7. Costo $0: en local los correos se ven en Mailpit y nada sale a internet.

## 2. Objetivos, no objetivos y anti-objetivos

- **Objetivos:** servicio `svc-notificaciones`; envío automático de correos con modo "con revisión" (aprobación previa) y "sin revisión"; WhatsApp asistido; plantillas editables; página de respuesta del paciente; pantalla "Recordatorios"; vista "Mi día"; marca "pide cambio" en la cita.
- **No objetivos:** WhatsApp automático (API de Meta) y SMS; varios recordatorios por cita u horas distintas por cita; confirmación al agendar; mensajes de receta o factura (fases 2 y 3); que el paciente elija nueva fecha por su cuenta.
- **Anti-objetivos:** un correo enviado sin aprobación mientras el modo sea "con revisión"; un enlace de respuesta reutilizable o que exponga datos de otras citas; teléfonos o correos de pacientes en eventos, logs o bitácora; un correo enviado dos veces por un reintento.

## 3. Enfoques considerados

| Enfoque | A favor | En contra |
|---|---|---|
| **A. Servicio nuevo `svc-notificaciones` con su base** — **elegido** | Es lo que prevé la arquitectura (§2.2); recetas y facturas (fases 2 y 3) usarán el mismo servicio y adaptadores | Un servicio más que correr |
| B. Recordatorios dentro de `svc-agenda` | Menos piezas hoy | Mezcla responsabilidades; habría que sacarlo en la Fase 2 |

La arquitectura ya fijaba la A; el dueño aprobó el diseño propuesto con sus cambios (revisión por adelantado y envío automático incluso en fin de semana).

## 4. Diseño

### 4.1 `svc-notificaciones` (servicio nuevo)
Mismo patrón que `svc-agenda`: Fastify, `notificaciones_db` con roles `notificaciones_migrator` / `notificaciones_app` (NOBYPASSRLS), RLS en todas las tablas de negocio, outbox e inbox, puerto **3005**, consumidor durable `notificaciones` (eventos `cita.creada`, `cita.reprogramada`, `cita.cancelada`). Variables: `AGENDA_URL`, `IDENTIDAD_URL`, `TOKEN_INTERNO`, `WEB_ORIGEN`, `SMTP_*`, `S3_*` (solo lectura).

| Tabla | Campos clave |
|---|---|
| `config_recordatorios` | tenant_id (PK), modo (`con_revision` \| `sin_revision`), hora_envio (`time`, por omisión `10:00`), zona_horaria (copiada de identidad al guardar), plantilla_correo_asunto, plantilla_correo_cuerpo, plantilla_whatsapp, actualizada_por, actualizada_en. **Sin fila = valores por omisión** (modo `con_revision`, 10:00, plantillas por omisión) |
| `envio` | id, tenant_id, cita_id, fecha_cita (`date` local de la cita), canal (`correo` \| `whatsapp_asistido`), estado (`pendiente`, `aprobado`, `enviado`, `fallido`, `anulado`), aprobado_por, aprobado_en, enviado_por (usuario, o null si fue automático), enviado_en, intentos, token_hash, token_expira_en, respuesta (`confirma` \| `cancela` \| `pide_cambio` \| null), respondido_en, respondido_por (`paciente` o id de usuario). `UNIQUE (tenant_id, cita_id, fecha_cita, canal)` |
| `corrida` | tenant_id, fecha_envio (`date` local), terminada_en — marca que el envío automático de ese día ya corrió (PK tenant_id + fecha_envio) |
| `consultorio` | tenant_id (PK), zona_horaria — consultorios que el programador debe atender. Se registra la primera vez que notificaciones procesa un evento de cita del consultorio, cuando alguien abre "Recordatorios" o cuando se guarda la configuración (la zona se pide a identidad). Como el consumidor durable nuevo recibe los eventos retenidos (30 días), los consultorios activos quedan registrados al arrancar |

- **Sin datos de contacto guardados:** `envio` no guarda teléfono ni correo; se piden a agenda al momento de mostrar o enviar.
- **Plantillas:** campos `{paciente}`, `{fecha}`, `{hora}`, `{medico}`, `{consultorio}`, `{telefono_consultorio}`. La función pura `rellenar(plantilla, datos, { html })` sustituye los campos, escapa HTML en el correo y deja tal cual los campos desconocidos. Límites: asunto ≤ 120, cuerpo ≤ 1000, WhatsApp ≤ 700 caracteres.
- **Búsqueda por token sin consultorio conocido:** la página pública llega solo con el token. Una función `fn_envio_por_token(hash text)` `SECURITY DEFINER` (dueño `notificaciones_migrator`, `search_path` fijo, `EXECUTE` solo para `notificaciones_app`) devuelve `tenant_id` y `envio_id`; el resto se hace con `withTenant`. Es el mismo patrón que `fn_membresias_usuario` en identidad.

### 4.2 Datos para el mensaje (llamadas internas)
Los eventos de citas no llevan datos de contacto. Notificaciones los pide en el momento:
- **Agenda:** `GET /interno/citas-para-recordatorio?tenantId&desde=YYYY-MM-DD&hasta=YYYY-MM-DD` → citas `agendada` o `confirmada` de esos días locales: `{ citaId, version, inicio, fin, estado, pideCambio, medicoId, medicoNombre, tipoCitaNombre, contacto: { nombre, telefono, email } }`.
- **Identidad:** `GET /interno/consultorio-para-mensaje?tenantId` → `{ nombreMostrado, telefono, colorPrimario, colorTexto, logoKey, zonaHoraria, pais }`.
- **Protección:** las rutas `/interno/*` exigen la cabecera `x-token-interno` igual a `TOKEN_INTERNO` (comparación de tiempo constante); sin ella responden `404`. El gateway **bloquea** `/api/<servicio>/interno/*` con `404`, así nunca son alcanzables desde internet. `TOKEN_INTERNO` se genera en `generar-dev-env.sh`; en AWS vive en Secrets Manager (solo código).
- **Tiempos:** 3 s de límite por llamada. Los datos del consultorio y su logo se piden una vez por lote de envío, no por correo.

### 4.3 Calendario de envío y modos
- **Regla:** el recordatorio de una cita sale el **día anterior** (en la zona del consultorio) a `hora_envio`, todos los días de la semana.
- **Programador automático** dentro del servicio: cada minuto, con `pg_try_advisory_lock`, revisa cada consultorio de la tabla `consultorio`. Si ya pasó su `hora_envio` local y no existe `corrida` para hoy: pide a agenda las citas de mañana, envía los correos que correspondan según el modo y registra la `corrida`. Si agenda o identidad no responden, no registra la corrida y vuelve a intentar al minuto siguiente.
- **Modo "con revisión" (inicial):** solo se envían los `envio` en estado `aprobado`. Los no aprobados quedan `pendiente` y la pantalla los marca "Sin aprobar — no se envió". Si se aprueba uno después de la hora de envío y antes del inicio de la cita, sale en ese momento.
- **Modo "sin revisión":** se envían todos los correos de mañana (los `pendiente` y `aprobado`).
- **Citas tardías:** una cita creada o reprogramada para mañana después de la corrida de hoy se envía en ese momento en modo "sin revisión"; en modo "con revisión" queda pendiente de aprobar.
- **Activar "sin revisión" o cambiar la hora después de la corrida del día:** surte efecto desde la siguiente corrida; los pendientes de mañana se pueden enviar desde la pantalla.
- **Cambio de cita después de enviado:** al consumir `cita.reprogramada`, los `envio` de esa cita para la fecha anterior pasan a `anulado` y su token deja de servir; si la nueva fecha es otra, se crea un `envio` nuevo para esa fecha (sigue las mismas reglas). `cita.cancelada` anula los envíos pendientes y aprobados de esa cita.
- **Reintentos de correo:** hasta 3 intentos por `envio`; cada reenvío genera un token nuevo e invalida el anterior (un solo token vigente por `envio`).
- Cambiar el modo, la hora o las plantillas emite `config_recordatorios.actualizada` (bitácora: "Recordatorios configurados").

### 4.4 Envío por correo
- **Adaptador `CanalCorreo`** con implementación SMTP (`nodemailer`). Variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USUARIO`/`SMTP_PASSWORD` (opcionales en local), `SMTP_REMITENTE`. En local apunta a **Mailpit** (contenedor nuevo: SMTP 1025, buzón web `http://localhost:8025`). Para el piloto se ponen las credenciales SMTP de cualquier proveedor con capa gratuita; el README explica que hay que configurar SPF/DKIM del dominio remitente para que no caigan en spam.
- **Contenido:** asunto y cuerpo de la plantilla; encabezado con el color del consultorio y, si existe, el logo adjunto en línea (CID) leído del almacenamiento (solo lectura sobre `logos/*`); botones "Confirmar", "Cancelar" y "Pedir cambio" que apuntan a `{WEB_ORIGEN}/r/{token}?accion=…`; versión de texto plano equivalente.
- **Token:** 32 bytes aleatorios en base64url; se guarda solo su SHA-256; vence al inicio de la cita; un solo uso.
- **Idempotencia:** el `envio` existe antes de enviar (`UNIQUE` por cita, fecha y canal); si ya está `enviado` no se reenvía. El envío ocurre fuera de transacción y después se marca `enviado` o `fallido`; el log registra el error sin datos del paciente.
- **Cita sin correo:** no hay `envio` de correo; la pantalla muestra "Sin correo — usa WhatsApp".

### 4.5 WhatsApp asistido
- Para citas con teléfono, la pantalla ofrece "Abrir WhatsApp": notificaciones devuelve el enlace `https://wa.me/{numero}?text={mensaje}` con la plantilla rellenada; el número se normaliza con `normalizarTelefono(telefono, pais)` de las reglas por país (sin el `+`). Si el teléfono no se puede normalizar, el botón no aparece y se muestra "Teléfono no válido para WhatsApp".
- Al abrirlo se registra el `envio` de WhatsApp como "abierto por {usuario}" (estado `enviado`, con `enviado_por`); la pantalla lo muestra como "WhatsApp abierto", porque el sistema no sabe si la persona presionó enviar.
- Cuando el paciente contesta por WhatsApp, recepción registra la respuesta con un clic ("Confirmó", "Canceló", "Pide cambio").

### 4.6 Respuesta del paciente
- **Página pública** `/r/{token}` en el sitio (fuera de la sesión): muestra consultorio (nombre y logo), fecha, hora y médico — sin datos clínicos ni de contacto — y los tres botones. Si el enlace trae `?accion=`, esa opción viene preseleccionada pero **siempre se confirma con un clic** (los lectores de correo que abren enlaces no deben responder solos).
- Rutas públicas nuevas del gateway, con el mismo límite de intentos por IP que las rutas públicas actuales: `GET /api/notificaciones/respuestas/{token}` y `POST /api/notificaciones/respuestas/{token}` `{ respuesta }`.
- Registrar una respuesta (del paciente o de recepción) actualiza el `envio` y emite **`cita.respuesta_paciente` v1** `{ citaId, inicioCita, respuesta, canal, origen: 'paciente' | 'recepcion' }` en la misma transacción. El sobre del evento lleva `actorId` = usuario de recepción, o null si respondió el paciente.

### 4.7 Agenda (cambios)
- Migración `002_pide_cambio.sql`: `cita.pide_cambio boolean NOT NULL DEFAULT false`. `citaSchema` agrega `pideCambio`.
- **Consumo de `cita.respuesta_paciente`:** si la cita ya no empieza en `inicioCita` (fue reprogramada) o ya está en un estado final, la respuesta se ignora y queda en el log. Si no, usa las mismas reglas de dominio que las acciones del personal (`transicionPermitida`):
  - `confirma` → `confirmada` (si estaba `agendada`);
  - `cancela` → `cancelada` (libera el hueco; emite `cita.cancelada`);
  - `pide_cambio` → `pide_cambio = true` (emite `cita.estado_cambiado` con el mismo estado).
  Cada escritura sube `version`. La reentrega del mensaje no duplica nada (inbox).
- **Eventos:** `cita.cancelada` y `cita.estado_cambiado` agregan el campo opcional `origen` (`'personal' | 'paciente' | 'recepcion'`), y `cita.estado_cambiado` el campo opcional `pideCambio`. Son cambios compatibles (campos opcionales), así que siguen en v1. La bitácora muestra "Cita confirmada por el paciente", "Cita cancelada por el paciente" o "Paciente pide cambio", e indica cuando lo registró recepción.
- Reprogramar una cita pone `pide_cambio = false`.
- Rutas internas de §4.2.

### 4.8 API de notificaciones (vía gateway `/api/notificaciones`, con JWT salvo las de respuesta)

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /recordatorios?desde&hasta` | admin, recepción | Lista combinada para la pantalla (máx. 7 días): por cita, nombre del paciente, médico, hora, estado de la cita y `pideCambio`, estado de correo y WhatsApp, respuesta, vista previa del correo y del WhatsApp, enlace de WhatsApp o motivo por el que no hay |
| `POST /recordatorios/{citaId}/aprobar` y `POST /recordatorios/aprobar` `{ desde, hasta }` | admin, recepción | Aprueba uno o todos los correos del rango |
| `POST /recordatorios/{citaId}/whatsapp` | admin, recepción | Registra "WhatsApp abierto" y devuelve el enlace |
| `POST /recordatorios/{citaId}/respuesta` `{ respuesta }` | admin, recepción | Registra la respuesta recibida por WhatsApp |
| `POST /recordatorios/{citaId}/reintentar` | admin, recepción | Reenvía un correo `fallido` |
| `GET /config` · `PUT /config` | GET: admin y recepción; PUT: admin | Modo, hora y plantillas |

El sitio nunca habla con agenda para esta pantalla: todo pasa por notificaciones.

### 4.9 Sitio web
- **"Recordatorios"** (`/recordatorios`, admin y recepción): por omisión muestra mañana y los dos días siguientes, agrupados por fecha y médico. Para cada cita: vista previa, estado (sin aprobar, aprobado, enviado, falló, sin correo), "Aprobar" / "Aprobar todos", "Abrir WhatsApp", botones de respuesta y "Reintentar". Arriba, el modo actual y la hora de envío.
- **"Mi consultorio" → sección "Recordatorios"** (admin): editor de asunto, cuerpo y WhatsApp con la lista de campos y vista previa con datos de ejemplo; hora de envío; selector de modo ("Con revisión: solo se envía lo aprobado" / "Sin revisión: todo se envía solo").
- **"Mi día"** (`/mi-dia`): usa la API de citas existente. Para un médico (su `medicoId` es su id de usuario), sus citas de hoy en la zona del consultorio, en orden, con estado y "Pide cambio"; abajo, sus citas de los próximos 7 días en estado `agendada`. Admin y recepción eligen médico. Pensada primero para celular; en el menú, "Mi día" aparece primero para los médicos.
- **Página pública `/r/[token]`** (§4.6), agregada a las rutas públicas del proxy.
- El calendario y la lista del día marcan "Pide cambio".

### 4.10 Docker e infraestructura
- Compose: `svc-notificaciones` (perfil `app`), `mailpit` (1025 y 8025), `notificaciones_db` y sus roles en `init.sql`, variables `TOKEN_INTERNO` y `SMTP_*`; el gateway agrega `NOTIFICACIONES_URL` y el bloqueo de `/interno`.
- `infra/` (solo código, $0): servicio Fargate de notificaciones, base `notificaciones_db`, secretos `TOKEN_INTERNO` y SMTP en Secrets Manager, solo lectura sobre `logos/*`.

## 5. Errores

| Caso | Comportamiento |
|---|---|
| Enlace vencido, anulado o inválido | Página: "Este enlace ya no es válido" (sin decir si existió) |
| Enlace ya usado | Página: "Esta cita ya fue respondida. Si necesitas otro cambio, llama al consultorio" con su teléfono |
| Falla del SMTP | `envio` `fallido`; la pantalla muestra "No se pudo enviar" con "Reintentar" |
| Agenda o identidad caídos | La corrida automática se reintenta al minuto siguiente; en la pantalla, aviso genérico |
| Respuesta sobre una cita que ya cambió | Se ignora y queda en el log; el paciente ve "Gracias, recibimos tu respuesta" |
| Llegó la hora sin aprobación (con revisión) | No se envía; la pantalla lo marca "Sin aprobar — no se envió" |

## 6. Pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | `rellenar` (campos, escape HTML, desconocidos); tokens (generación, hash, vencimiento); reglas del programador (día anterior en la zona del consultorio, incluido domingo, ya corrió hoy, citas tardías, modo con/sin revisión); reglas de respuesta; enlace de WhatsApp y normalización de teléfono |
| Integración | Notificaciones con Postgres, NATS, MinIO y Mailpit reales: con revisión solo sale lo aprobado; sin revisión sale todo a la hora y no antes; no se reenvía; reprogramar anula el token anterior y crea envío nuevo; token de un solo uso y vencido; búsqueda por token con la función `SECURITY DEFINER`; RLS entre consultorios; `cita.respuesta_paciente` en el outbox. Agenda: consumo de respuestas (incluida la ignorada por reprogramación), `pide_cambio`, rutas internas rechazan sin token. Gateway: `/api/*/interno/*` → 404; rutas públicas de respuesta con límite de intentos |
| E2E de API | Agendar → aprobar → forzar la corrida (reloj inyectado) → leer el correo en la API de Mailpit → responder con el token → la cita queda `confirmada` |
| E2E de navegador | La encargada aprueba en "Recordatorios"; el paciente abre `/r/{token}` y cancela; la cita aparece cancelada; el médico ve "Mi día" en viewport de celular |

Cobertura ≥ 80% de líneas y ramas por paquete. El reloj se inyecta en el programador para poder probar la hora de envío.

## 7. Decisiones tomadas por el diseñador (corregibles)
- Hora por omisión 10:00; envíos todos los días, incluido el domingo.
- Los datos de contacto se piden a agenda por rutas internas protegidas con un token compartido, nunca por eventos.
- El enlace del correo nunca responde solo: el paciente confirma con un clic.
- Reprogramar anula el recordatorio anterior y su enlace; cada reenvío genera un enlace nuevo.
- "WhatsApp abierto" en lugar de "enviado", porque el sistema no puede saber si se envió.
- El logo va adjunto en línea en el correo; Mailpit en local; SMTP genérico para el piloto.
- La respuesta del paciente usa las mismas reglas que las acciones del personal; los eventos ganan el campo opcional `origen`.

## 8. Queda a criterio del implementador
Textos por omisión de las plantillas (en español, cordiales y breves), distribución visual de las pantallas, nombres internos siguiendo las capas dominio/rutas/datos y la forma exacta del programador por minuto.
