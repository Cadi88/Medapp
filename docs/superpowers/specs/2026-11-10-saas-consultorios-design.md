# SaaS para consultorios médicos (México) — Documento de diseño

- **Fecha:** 2026-11-10
- **Estado:** Borrador para revisión
- **Alcance de este documento:** arquitectura completa del MVP (fases 0–3). Cada fase tendrá su propio plan de implementación.

---

## 1. Contexto y objetivo

### 1.1 Qué estamos construyendo
Un **SaaS multi-tenant** que se vende por suscripción a **consultorios médicos pequeños en México** (1–5 médicos). Cubre agenda con recordatorios, expediente clínico conforme a NOM-004, receta médica y facturación CFDI 4.0.

### 1.2 Decisiones del usuario (fuente: conversación de diseño)
| Tema | Decisión |
|---|---|
| Propósito | Producto SaaS para vender |
| Equipo | Un desarrollador, TypeScript/JavaScript |
| MVP | Agenda + recordatorios, Expediente (NOM-004), Receta, Facturación CFDI + cobros |
| NOM-024 | Arquitectura preparada desde el día uno; certificación DGIS después |
| Escala objetivo (2 años) | Decenas a ~500 consultorios |
| Estilo de arquitectura | **Microservicios** (elegido sobre el monolito modular recomendado) |
| Aislamiento de datos | Servicios por dominio; cada uno con su base Postgres compartida entre tenants, aislada con `tenant_id` + Row-Level Security |

### 1.3 Referencias del research que inspiran el diseño
- **eClinicalWorks / athenahealth:** expediente + gestión del consultorio integrados en una sola suite.
- **Nimbo:** cumplimiento NOM-004/NOM-024 y precio accesible para consultorio pequeño.
- **Doctoralia / AgendaPro:** reserva en línea y recordatorios que reducen inasistencias.
- **Medilink / Medesk:** multi-médico y facturación electrónica local integrada.

### 1.4 Criterios de éxito
1. Un médico se registra solo, configura su consultorio y atiende + factura su primera consulta **el mismo día**.
2. Ningún consultorio puede leer datos de otro, garantizado por la base de datos (RLS), verificado por pruebas automáticas.
3. Las notas firmadas no se pueden alterar; toda lectura y cambio del expediente queda en una bitácora verificable.
4. La caída de un servicio no detiene a los demás (p. ej., sin facturación se puede seguir agendando y consultando).
5. Llegar a ~500 consultorios sin reescribir la arquitectura; solo escalando infraestructura.

### 1.5 Restricciones normativas
| Norma | Implicación en el diseño |
|---|---|
| NOM-004-SSA3-2012 | Contenido obligatorio del expediente; conservación mínima de 5 años → no hay borrado físico |
| NOM-024-SSA3-2012 | Bitácora de auditoría, identificación de pacientes (CURP), catálogos (CIE-10), firma, integridad e intercambio → preparados ahora; HL7/CDA y e.firma después |
| CFDI 4.0 (SAT) | Timbrado vía PAC; el CSD lo custodia el PAC |
| LFPDPPP | Datos de salud = datos sensibles; aviso de privacidad, cifrado, hospedaje en México |

---

## 2. Arquitectura general

### 2.1 Diagrama
```
                 ┌──────────────────────────────┐
  Médico/recepción│  web (Next.js)               │  Paciente
  ───────────────▶│  · app del consultorio       │◀──────────── reserva en línea
                 │  · páginas públicas de reserva│
                 └──────────────┬───────────────┘
                                │ HTTPS (JWT)
                 ┌──────────────▼───────────────┐
                 │  gateway (BFF)               │
                 └─┬──────┬──────┬──────┬───────┘
          REST interno│      │      │      │
   ┌──────────▼┐ ┌───▼────┐ ┌▼──────────┐ ┌▼────────────┐
   │ identidad │ │ agenda │ │ expediente│ │ facturacion │
   │ + cuentas │ │        │ │ + receta  │ │ + cobros    │
   └─────┬─────┘ └───┬────┘ └─────┬─────┘ └──────┬──────┘
         │ PG        │ PG         │ PG + S3      │ PG ──▶ PAC
         └───────────┴─────┬──────┴──────────────┘
                 eventos (outbox → NATS JetStream)
                   ┌───────┴────────┐
          ┌────────▼──────┐  ┌──────▼──────┐
          │ notificaciones│  │  auditoria  │
          └───────────────┘  └─────────────┘
```

### 2.2 Servicios
| Servicio | Responsabilidad | Dueño de los datos |
|---|---|---|
| **gateway** | Único punto de entrada: verifica JWT, resuelve tenant activo, rate limiting, enrutamiento, rutas públicas de reserva | Sin base de datos |
| **identidad** | Consultorios (tenants), usuarios, membresías, roles, perfil del médico (cédula, especialidad), plan y suscripción SaaS, autenticación (Better Auth, MFA para médicos) | `identidad_db` |
| **agenda** | Horarios por médico, bloqueos, disponibilidad, citas, reserva pública | `agenda_db` |
| **expediente** | Pacientes, historia clínica, consultas (notas SOAP), signos vitales, diagnósticos CIE-10, adjuntos, firma, adendas, **receta** | `expediente_db` + S3 |
| **facturacion** | Cobros, caja, facturas CFDI 4.0 vía PAC, cancelaciones | `facturacion_db` + S3 |
| **notificaciones** | Envío de WhatsApp/SMS/email; recordatorios programados; webhooks de respuesta del paciente | `notificaciones_db` |
| **auditoria** | Bitácora append-only con encadenamiento hash por tenant; consume eventos de todos los servicios | `auditoria_db` |

### 2.3 Reglas de arquitectura
1. **Cada servicio es dueño exclusivo de su base.** Ningún servicio lee ni escribe la base de otro.
2. **La receta vive dentro de expediente.** NOM-004 la considera parte del expediente y se emite dentro de una consulta firmada; separarla exigiría transacciones distribuidas sin beneficio.
3. **REST interno solo para consultas síncronas de un salto** (p. ej., validar que un médico existe). Nunca cadenas síncronas de más de un salto; los flujos multi-servicio van por eventos.
4. **Eventos con patrón outbox:** el evento se escribe en la tabla `outbox` en la misma transacción que el cambio de datos; un publicador lo envía a NATS JetStream. Si NATS cae, los eventos esperan en Postgres.
5. **Consumidores idempotentes:** tabla `inbox` con `event_id` procesados.
6. **Contratos compartidos y versionados:** esquemas Zod de APIs y eventos en `packages/contracts`.

### 2.4 Monorepo
Herramientas: pnpm workspaces + Turborepo.
```
apps/
  web/                  Next.js
  gateway/
  svc-identidad/
  svc-agenda/
  svc-expediente/
  svc-facturacion/
  svc-notificaciones/
  svc-auditoria/
packages/
  contracts/            Esquemas Zod: APIs y eventos (versionados)
  platform/             Contexto de tenant + RLS, outbox/inbox, cliente NATS,
                        auth middleware, logging (pino), OpenTelemetry, errores
  ui/                   Componentes compartidos del frontend
infra/                  AWS CDK (TypeScript)
docker-compose.yml      Entorno local completo
```
Regla de dependencias: `apps/svc-*` pueden depender de `packages/*`, nunca de otro `apps/*`.

---

## 3. Datos y multi-tenancy

### 3.1 Multi-tenancy (todos los servicios)
- **Tenant = consultorio.** Un usuario puede pertenecer a varios consultorios mediante `membresia(usuario_id, tenant_id, rol)`. El JWT incluye el `tenant_id` activo y el rol.
- Toda tabla de negocio tiene `tenant_id uuid NOT NULL` y política RLS:
  `USING (tenant_id = current_setting('app.tenant_id')::uuid)` y el mismo `WITH CHECK`.
- Los servicios se conectan con un rol **sin `BYPASSRLS`** y sin ser dueño de las tablas. Las migraciones corren con un rol distinto.
- `packages/platform` abre cada transacción con `SET LOCAL app.tenant_id = $1`; el código de negocio no puede omitirlo.
- Cada servicio tiene una prueba que intenta leer/escribir datos de otro tenant y debe fallar.
- Identificadores **UUIDv7**. Fechas en UTC (`timestamptz`); cada tenant guarda su zona horaria IANA (p. ej., `America/Mexico_City`, `America/Tijuana`).

### 3.2 identidad
| Tabla | Campos clave |
|---|---|
| `tenant` | id, nombre, slug público, zona_horaria, plan, estado_suscripcion |
| `usuario` | id, email, nombre, mfa_activo |
| `membresia` | usuario_id, tenant_id, rol (`admin`, `medico`, `recepcion`) |
| `perfil_medico` | usuario_id, tenant_id, cedula_profesional, especialidad, cedula_especialidad, institucion |
| `datos_fiscales` | tenant_id, rfc, razon_social, regimen_fiscal, cp, id del emisor en el PAC |

En `identidad`, las tablas `tenant` y `usuario` son globales (sin RLS por tenant; el acceso se controla en el servicio). `membresia`, `perfil_medico` y `datos_fiscales` sí tienen RLS.

### 3.3 agenda
| Tabla | Campos clave |
|---|---|
| `horario_medico` | medico_id, dia_semana, hora_inicio, hora_fin, duracion_cita_min |
| `bloqueo` | medico_id, rango (`tstzrange`), motivo |
| `cita` | medico_id, rango (`tstzrange`), estado, contacto (nombre, teléfono, email), paciente_ref (nullable, id en expediente), origen (`recepcion`, `reserva_publica`) |

- Estados de cita: `agendada → confirmada → atendida`, o `cancelada` / `no_asistio`.
- **Sin doble reserva:** `EXCLUDE USING gist (tenant_id WITH =, medico_id WITH =, rango WITH &&) WHERE (estado NOT IN ('cancelada'))` (requiere la extensión `btree_gist`).

### 3.4 expediente
| Tabla | Campos clave |
|---|---|
| `paciente` | nombre, apellidos, fecha_nacimiento, sexo, curp (nullable, única por tenant), contacto, estado (`activo`, `archivado`) |
| `historia_clinica` | paciente_id, antecedentes (JSON con esquema versionado) |
| `consulta` | paciente_id, medico_id, cita_id (nullable), estado (`borrador`, `firmada`), nota SOAP (JSON + `plantilla_version`), firma |
| `signos_vitales` | consulta_id, peso, talla, ta_sistolica, ta_diastolica, fc, fr, temperatura, spo2 |
| `diagnostico` | consulta_id, codigo_cie10, descripcion, tipo (`principal`, `secundario`) |
| `adenda` | consulta_id, texto, medico_id, firma |
| `receta` | consulta_id, folio (consecutivo por tenant), snapshot_medico, indicaciones_generales, token_verificacion |
| `folio_contador` | tenant_id, tipo (`receta`), ultimo_folio — se incrementa con `UPDATE ... RETURNING` dentro de la transacción de firma (bloqueo de fila, sin huecos ni duplicados) |
| `receta_medicamento` | receta_id, medicamento (texto), presentacion, dosis, frecuencia, duracion, via |
| `adjunto` | paciente_id, consulta_id (nullable), s3_key, tipo_mime, descripcion |
| `catalogo_cie10` | código, descripción (tabla global de solo lectura, sin tenant) |

Reglas:
- **Inmutabilidad:** un trigger rechaza `UPDATE` y `DELETE` sobre `consulta` (y sus hijas `signos_vitales`, `diagnostico`, `receta`, `receta_medicamento`) cuando la consulta está `firmada`. Las correcciones solo se hacen con `adenda`, también firmada e inmutable.
- **Firma (MVP):** `firma = { hash: sha256(json_canonico(contenido)), usuario_id, cedula, firmado_en }`. **Firma (certificación):** se agrega firma con e.firma (FIEL) en el mismo campo, sin cambiar el modelo.
- **Sin borrado físico** de pacientes, consultas ni adjuntos (NOM-004, conservación ≥ 5 años). Solo `archivado`.
- **Receta:** se emite al firmar la consulta si tiene medicamentos. `snapshot_medico` copia nombre, cédula, especialidad e institución al momento de emitir. El PDF se genera de forma asíncrona en una ruta S3 determinista (`recetas/{tenant_id}/{receta_id}.pdf`), así la receta firmada nunca necesita actualizarse; si el PDF aún no existe al solicitarlo, se genera bajo demanda. El PDF incluye QR a `/verificar/receta/{token}` (página pública que muestra validez, fecha, médico y folio; sin datos clínicos).
- Adjuntos en S3 con cifrado del lado del servidor y URLs prefirmadas de corta duración.

### 3.5 facturacion
| Tabla | Campos clave |
|---|---|
| `cobro` | origen (`consulta`, `manual`), consulta_id (nullable), paciente_ref, concepto, monto, metodo (`efectivo`, `tarjeta`, `transferencia`), estado (`pendiente`, `pagado`, `anulado`) |
| `factura` | cobro_id(s), receptor (RFC o público en general, régimen, uso CFDI, CP), estado (`pendiente`, `timbrando`, `timbrada`, `error`, `cancelada`), uuid_sat, xml_key, pdf_key, idempotency_key, error_mensaje |

Reglas:
- Toda llamada al PAC lleva `idempotency_key` para no timbrar dos veces.
- **El CSD del emisor lo custodia el PAC**; el sistema nunca almacena la llave privada.
- Los servicios médicos están exentos de IVA cuando los presta un profesional con título; la configuración fiscal del concepto se define por tenant.

### 3.6 notificaciones
| Tabla | Campos clave |
|---|---|
| `plantilla` | canal, tipo (`confirmacion`, `recordatorio`, `receta`, `factura`), contenido |
| `envio` | canal, destinatario, tipo, referencia (cita/receta/factura), estado, proveedor_id, intentos |

### 3.7 auditoria
| Tabla | Campos clave |
|---|---|
| `evento_auditoria` | tenant_id, secuencia, ocurrido_en, actor_id, accion, recurso_tipo, recurso_id, servicio, detalle (JSON), hash_anterior, hash |

- `hash = sha256(hash_anterior || json_canonico(registro))`, una cadena por tenant con `secuencia` monotónica.
- El rol del servicio solo tiene `INSERT` y `SELECT` sobre esta tabla.
- Tarea diaria que verifica la integridad de cada cadena y alerta si se rompe.
- Se registran **lecturas** del expediente (`expediente.accedido`), no solo escrituras.

### 3.8 Seguridad de datos
- TLS en todo el tránsito (externo e interno).
- Cifrado en reposo: RDS y S3 con KMS.
- Respaldos automáticos con PITR (retención 35 días) + exportación mensual a almacenamiento frío.
- Hospedaje en la región AWS México (`mx-central-1`).
- MFA obligatorio para usuarios con rol `medico` y `admin`.

---

## 4. Eventos

Formato común (definido en `packages/contracts`):
```ts
{
  event_id: string;        // UUIDv7
  type: string;            // p. ej. "cita.creada"
  version: number;         // versión del esquema del evento
  tenant_id: string;
  actor_id: string | null;
  occurred_at: string;     // ISO 8601 UTC
  trace_id: string;        // OpenTelemetry
  data: unknown;           // validado por el esquema del tipo
}
```

| Evento | Emite | Consumen |
|---|---|---|
| `tenant.creado` | identidad | agenda, expediente, facturacion, notificaciones, auditoria |
| `usuario.vinculado` / `medico.actualizado` | identidad | agenda, expediente, auditoria |
| `cita.creada` / `cita.reprogramada` / `cita.cancelada` | agenda | notificaciones, auditoria |
| `cita.respuesta_paciente` | notificaciones | agenda, auditoria |
| `paciente.creado` / `paciente.actualizado` | expediente | agenda (para mostrar nombre), auditoria |
| `expediente.accedido` | expediente | auditoria |
| `consulta.firmada` | expediente | agenda (marca atendida), facturacion (crea cobro pendiente), auditoria |
| `adenda.firmada` | expediente | auditoria |
| `receta.emitida` | expediente | notificaciones (si el médico elige enviarla), auditoria |
| `cobro.registrado` / `factura.timbrada` / `factura.cancelada` / `factura.error` | facturacion | notificaciones, auditoria |

---

## 5. Flujos principales

### 5.1 Reserva y recordatorio
1. El paciente abre `/c/{slug}`; el gateway sirve disponibilidad desde agenda (ruta pública con rate limit por IP).
2. agenda crea la cita; el `EXCLUDE` rechaza el horario si fue tomado concurrentemente (el paciente ve "horario no disponible" y elige otro). Escribe `cita.creada` en outbox.
3. notificaciones envía confirmación por WhatsApp y programa recordatorio 24 h antes (pg-boss).
4. El paciente responde "Confirmar"/"Cancelar" → webhook en notificaciones → `cita.respuesta_paciente` → agenda actualiza el estado.

### 5.2 Consulta → receta → cobro
1. Recepción vincula la cita a un paciente existente o crea uno en expediente (la reserva pública no crea expedientes).
2. El médico abre la consulta en `borrador`: SOAP, signos vitales, CIE-10, medicamentos.
3. Al firmar, en una sola transacción de expediente: consulta → `firmada`, receta con folio, `consulta.firmada` y `receta.emitida` en outbox.
4. Reacciones: agenda marca la cita `atendida`; facturacion crea `cobro` pendiente; auditoria registra; una tarea genera el PDF de la receta.

### 5.3 Factura CFDI
1. Recepción marca el cobro como pagado y solicita factura (RFC del paciente o público en general).
2. facturacion crea `factura` en `pendiente` y encola el timbrado.
3. La tarea llama al adaptador del PAC con `idempotency_key` → `timbrada` (guarda XML/PDF en S3, emite `factura.timbrada`) o `error`.
4. notificaciones envía PDF + XML por email.

---

## 6. Manejo de errores

| Situación | Comportamiento |
|---|---|
| Servicio caído | Los demás siguen operando. La UI muestra el módulo afectado como "no disponible" sin bloquear el resto. Los eventos pendientes se procesan cuando el servicio vuelve. |
| Llamada REST interna | Timeout de 2 s, 2 reintentos con backoff exponencial, circuit breaker. |
| Evento duplicado o desordenado | Consumidores idempotentes (`inbox`); los handlers validan el estado actual antes de aplicar cambios. |
| Evento que falla repetidamente | Tras 5 intentos va a una cola dead-letter y dispara una alerta. Nunca se descarta en silencio. |
| PAC no disponible / timeout | Reintentos con backoff (hasta 6 intentos en ~1 h). Después: `factura.estado = error` con mensaje y botón "reintentar". |
| Rechazo del SAT (datos inválidos) | No se reintenta; se muestra el motivo para que el usuario corrija los datos fiscales. |
| WhatsApp falla | Respaldo a SMS y luego email; queda registrado en `envio`. |
| Validación | Mismos esquemas Zod en web, gateway y servicios. Errores con formato único `{ code, message, details }`. |
| Intento de editar consulta firmada | El trigger lo rechaza; el servicio responde 409 `CONSULTA_FIRMADA` y la UI ofrece crear adenda. |

---

## 7. Stack e infraestructura

### 7.1 Stack
| Capa | Elección |
|---|---|
| Frontend | Next.js (App Router) + componentes en `packages/ui` |
| Servicios | Node.js LTS + Fastify + TypeScript |
| Datos | PostgreSQL 16 + Drizzle ORM (SQL directo para RLS, EXCLUDE y triggers) |
| Autenticación | Better Auth en `svc-identidad`; JWT firmados (JWKS) verificados por gateway y servicios |
| Eventos | NATS JetStream |
| Tareas programadas | pg-boss (por servicio) |
| PDFs | Generación en servidor (receta, factura si el PAC no la provee) |
| PAC | Facturapi (adaptador `PacAdapter`, reemplazable por Facturama) |
| Mensajería | Meta WhatsApp Cloud API; Twilio para SMS; proveedor SMTP/SES para email |
| Suscripción SaaS | Stripe (fase 3) |

### 7.2 Infraestructura (AWS `mx-central-1`)
- **ECS Fargate:** un servicio ECS por microservicio + gateway + web.
- **RDS PostgreSQL:** una instancia con una base por servicio; separables a instancias propias sin cambiar código.
- **NATS JetStream:** 1 nodo al inicio (los eventos están protegidos por el outbox), clúster de 3 al crecer.
- **S3** con KMS; **CloudFront** frente a web.
- **AWS CDK (TypeScript)** para infraestructura como código.
- **GitHub Actions + Turborepo:** build, pruebas y despliegue solo de lo que cambió.
- **Local:** `docker compose` con todos los servicios, Postgres, NATS, MinIO y PAC en modo pruebas.
- **Costo inicial estimado:** ~$150–300 USD/mes.

### 7.3 Observabilidad
- OpenTelemetry en todos los servicios; `trace_id` propagado en HTTP y en eventos.
- Logs estructurados (pino) con `tenant_id`, `trace_id`, `servicio`.
- Alertas: mensajes en dead-letter, errores del PAC, ruptura de cadena de auditoría, tasa de 5xx, latencia p95.

---

## 8. Pruebas
| Nivel | Qué cubre | Herramienta |
|---|---|---|
| Unitarias | Reglas de dominio: transiciones de estado, folios, cálculo de disponibilidad, hash canónico | Vitest |
| Integración por servicio | Postgres real: aislamiento entre tenants (RLS), `EXCLUDE` de citas, triggers de inmutabilidad, cadena de auditoría, outbox/inbox | Vitest + Testcontainers |
| Contratos | Productores y consumidores validan contra los esquemas de `packages/contracts` | Vitest |
| E2E | Reserva pública → consulta → receta → factura (PAC en modo pruebas) | Playwright + docker compose |

Regla: ningún servicio se despliega si falla su prueba de aislamiento entre tenants.

---

## 9. Fases de construcción
| Fase | Contenido | Resultado |
|---|---|---|
| **0 · Plataforma** | Monorepo, `contracts`, `platform` (tenant/RLS, outbox/inbox, auth, observabilidad), gateway, identidad (registro de consultorio, usuarios, roles, MFA), auditoria, docker compose, CI/CD, infraestructura base | Base técnica |
| **1 · Agenda** | agenda + notificaciones, reserva pública, recordatorios WhatsApp con respaldo SMS/email | Agenda en línea vendible; pilotos gratuitos |
| **2 · Expediente** | expediente + receta: pacientes, historia clínica, SOAP, signos vitales, CIE-10, firma, adendas, receta con QR, adjuntos | Producto principal |
| **3 · Facturación** | facturacion: cobros, caja, CFDI 4.0, cancelaciones; suscripción SaaS con Stripe | Producto completo, cobrando |

Cada fase tendrá su propio plan de implementación.

## 10. Fuera de alcance del MVP
- Interoperabilidad HL7/CDA y firma con e.firma (se agregan para la certificación NOM-024).
- Portal del paciente.
- Múltiples sucursales por consultorio.
- App móvil nativa.
- Dictado/resumen con IA.
- Integración con farmacias y laboratorios.
- Base de datos dedicada por consultorio.

## 11. Riesgos
| Riesgo | Mitigación |
|---|---|
| Carga operativa de microservicios para un solo desarrollador | Monorepo, `packages/platform` compartido, una instancia RDS, ECS Fargate, observabilidad desde la fase 0 |
| Fugas de datos entre consultorios | RLS obligatorio en la base + prueba de aislamiento que bloquea despliegues |
| Cambios del SAT / PAC | Adaptador `PacAdapter`; el PAC absorbe cambios de esquema CFDI |
| Costos y políticas de WhatsApp | Adaptador de mensajería; respaldo SMS/email; plantillas aprobadas por Meta |
| Requisitos de certificación NOM-024 no previstos | Bitácora, firma, inmutabilidad y datos estructurados desde el día uno; revisión de la norma antes de la fase 2 |
