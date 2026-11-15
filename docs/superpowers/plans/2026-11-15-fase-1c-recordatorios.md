# Fase 1 · Entrega 3 — Recordatorios y "Mi día" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los recordatorios por correo salen solos el día anterior a cada cita (con aprobación previa en el modo inicial), el paciente responde sin cuenta, recepción usa WhatsApp asistido para quien no tiene correo, y el médico ve "Mi día".

**Architecture:** Un servicio nuevo `svc-notificaciones` (Fastify, `notificaciones_db` con RLS, outbox/inbox) programa y registra envíos; pide los datos de contacto a agenda y los del consultorio a identidad por rutas `/interno/*` protegidas con un token compartido y bloqueadas en el gateway. La respuesta del paciente produce `cita.respuesta_paciente`, que agenda aplica con sus reglas de dominio. El sitio agrega "Recordatorios", la configuración en "Mi consultorio", la página pública `/r/[token]` y "Mi día".

**Tech Stack:** Lo existente (Node 24, TS estricto ESM, Fastify 5, Zod 4, Postgres 16, NATS JetStream, Luxon, Next.js 16, Vitest, Testcontainers, Playwright) más `nodemailer` y Mailpit (imagen `axllent/mailpit`).

**Spec:** `docs/superpowers/specs/2026-11-15-fase-1c-recordatorios-design.md`

## Global Constraints

- Todas las Global Constraints de `docs/superpowers/plans/2026-11-11-fase-1a-web-agenda.md` y `docs/superpowers/plans/2026-11-12-fase-1b-personalizacion.md` siguen vigentes (capas dominio/rutas/datos, ACID con outbox en la misma transacción, reloj inyectado, `no-explicit-any`, cobertura ≥ 80% de líneas y ramas con `test/unit` y `test/integration`, $0 sin `cdk deploy`/`bootstrap`/`aws`, commit por tarea).
- `svc-notificaciones`: puerto **3005**, base `notificaciones_db`, roles `notificaciones_migrator` / `notificaciones_app` (NOBYPASSRLS), consumidor durable `notificaciones`.
- Envío: el **día anterior** a la cita (zona del consultorio) a `hora_envio` (por omisión **10:00**), **todos los días incluido el domingo**.
- Modos: `con_revision` (por omisión: solo se envía lo `aprobado`) y `sin_revision` (se envía todo).
- Ningún teléfono ni correo de paciente en eventos, logs, bitácora ni en las tablas de notificaciones.
- Rutas `/interno/*`: cabecera `x-token-interno` = `TOKEN_INTERNO` (comparación de tiempo constante), si no `404`; el gateway responde `404` a `/api/<servicio>/interno/*`. Timeout de 3 s en llamadas internas.
- Token de respuesta: 32 bytes aleatorios base64url; se guarda solo su SHA-256; vence al inicio de la cita; un solo uso; un solo token vigente por `envio`.
- Correo: hasta 3 intentos por `envio`; nunca dos envíos del mismo `envio`.
- Plantillas: campos `{paciente}`, `{fecha}`, `{hora}`, `{medico}`, `{consultorio}`, `{telefono_consultorio}`; asunto ≤ 120, cuerpo ≤ 1000, WhatsApp ≤ 700 caracteres.
- Textos exactos (spec §5): "Este enlace ya no es válido", "Esta cita ya fue respondida. Si necesitas otro cambio, llama al consultorio", "Gracias, recibimos tu respuesta", "Sin aprobar — no se envió", "Sin correo — usa WhatsApp", "Teléfono no válido para WhatsApp", "WhatsApp abierto", "No se pudo enviar".
- El enlace del correo nunca responde solo: la página exige un clic de confirmación.

## Review Focus

1. **Cita reprogramada después de enviado su recordatorio** → el enlace viejo responde "Este enlace ya no es válido" y la cita nueva recibe su propio recordatorio. Prueba en Task 4.
2. **El programador corre dos veces el mismo día (reinicio del servicio o dos réplicas)** → ningún correo sale dos veces. Prueba en Task 5.
3. **Domingo con zona horaria distinta (p. ej., `America/Tijuana`)** → el correo sale a las 10:00 locales del sábado para citas del domingo y del domingo para las del lunes, y no a las 10:00 UTC. Prueba en Task 4 (reglas) y Task 5 (programador).
4. **Un lector de correo abre el enlace automáticamente** → la cita no cambia hasta que el paciente presiona el botón. Prueba en Task 7.
5. **Paciente responde "cancelar" sobre una cita que recepción ya marcó atendida** → se ignora y la cita sigue atendida; el paciente ve "Gracias, recibimos tu respuesta". Prueba en Task 2.

---

## Mapa de archivos

```
packages/platform/src/http/token-interno.ts      requireTokenInterno, llamarInterno
packages/contracts/src/events/{agenda,notificaciones}.ts, api/notificaciones.ts
apps/gateway/src/rutas.ts                        bloqueo /interno, servicio notificaciones, rutas públicas de respuesta
apps/svc-agenda/migrations/002_pide_cambio.sql
apps/svc-agenda/src/rutas/interno.ts, src/consumidor.ts (respuestas), src/dominio/respuestas.ts
apps/svc-identidad/src/routes/interno.ts
apps/svc-notificaciones/                          servicio nuevo
  migrations/001_notificaciones.sql
  src/dominio/{plantillas,token,calendario,whatsapp}.ts
  src/datos/{config,envios,corridas,consultorios}.ts
  src/externos/{agenda,identidad}.ts, src/correo/{canal,smtp,mensaje}.ts
  src/programador.ts, src/consumidor.ts
  src/rutas/{recordatorios,config,respuestas}.ts, src/{server,main}.ts
apps/web/src/features/{recordatorios,mi-dia,respuesta}/**, features/consultorio (sección Recordatorios)
apps/web/src/app/(app)/{recordatorios,mi-dia}/page.tsx, app/r/[token]/page.tsx
docker-compose.yml, docker/postgres/init.{sql,sh}, scripts/generar-dev-env.sh, .env.example
tests/e2e/test/recordatorios.e2e.test.ts, tests/e2e-web/test/recordatorios.spec.ts
infra/lib/{datos,servicios}.ts, infra/test/infra.test.ts, README.md
```

---

### Task 1: Rutas internas protegidas y contratos

**Files:**
- Create: `packages/platform/src/http/token-interno.ts`, `apps/svc-agenda/src/rutas/interno.ts`, `apps/svc-identidad/src/routes/interno.ts`, `packages/contracts/src/events/notificaciones.ts`, `packages/contracts/src/api/notificaciones.ts`
- Modify: `packages/platform/src/index.ts`, `packages/contracts/src/{index.ts,events/agenda.ts}`, `apps/svc-agenda/src/{server.ts,main.ts}`, `apps/svc-identidad/src/{server.ts,main.ts}`, `apps/gateway/src/rutas.ts`
- Test: `packages/platform/test/unit/token-interno.test.ts`, `packages/contracts/test/unit/eventos-notificaciones.test.ts`, `apps/svc-agenda/test/integration/interno.test.ts`, `apps/svc-identidad/test/integration/interno.test.ts`, `apps/gateway/test/unit/rutas.test.ts`

**Interfaces:**
- Produces:
  - `requireTokenInterno(token: string): preHandler`: compara `x-token-interno` con `crypto.timingSafeEqual` (longitudes distintas → falso); si no coincide lanza `AppError('NO_ENCONTRADO', 'No encontrado', 404)`. Las rutas que lo usan se registran como públicas para el plugin JWT.
  - `llamarInterno<T>(base: string, ruta: string, token: string, esquema: z.ZodType<T>, timeoutMs = 3000): Promise<T>` (fetch con `AbortSignal.timeout`; respuesta que no cumple el esquema o status ≠ 200 → `Error`).
  - Agenda: `GET /interno/citas-para-recordatorio?tenantId&desde&hasta` (fechas `YYYY-MM-DD`, máx. 8 días) → `{ citas: CitaParaRecordatorio[] }` con `{ citaId, version, inicio, fin, estado, pideCambio, medicoId, medicoNombre, tipoCitaNombre, contacto: { nombre, telefono, email: string | null } }`; solo `agendada` y `confirmada`; usa `withTenant(tenantId)` y la zona de su tabla `consultorio`. `pideCambio` se devuelve como `false` hasta la Task 2.
  - Identidad: `GET /interno/consultorio-para-mensaje?tenantId` → `{ nombreMostrado, telefono, colorPrimario, colorTexto, logoKey, zonaHoraria, pais }`.
  - Variable `TOKEN_INTERNO` obligatoria en agenda e identidad (mín. 32 caracteres).
  - Contratos (en `packages/contracts`): `citaParaRecordatorioSchema`, `consultorioParaMensajeSchema`; `CitaRespuestaPaciente = defineEvent('cita.respuesta_paciente', 1, { citaId, inicioCita (iso con offset), respuesta: 'confirma' | 'cancela' | 'pide_cambio', canal: 'correo' | 'whatsapp_asistido', origen: 'paciente' | 'recepcion' })`; `ConfigRecordatoriosActualizada = defineEvent('config_recordatorios.actualizada', 1, { campos: string[] })`; `CitaCancelada` y `CitaEstadoCambiado` agregan `origen?: 'personal' | 'paciente' | 'recepcion'` y `CitaEstadoCambiado` agrega `pideCambio?: boolean` (opcionales; siguen en v1).
  - Gateway: `/api/<servicio>/interno` y `/api/<servicio>/interno/*` → 404 antes de enrutar (para todo servicio, incluido el futuro `notificaciones`).

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('requireTokenInterno: token correcto pasa; incorrecto, ausente o de otra longitud → 404', async () => { /* ... */ });
test('agenda /interno/citas-para-recordatorio sin token → 404; con token → solo agendada/confirmada del rango con contacto', async () => { /* ... */ });
test('agenda interno: rango > 8 días → 400; tenant ajeno no mezcla citas', async () => { /* ... */ });
test('identidad /interno/consultorio-para-mensaje devuelve nombreMostrado (nombre comercial o nombre) y logoKey', async () => { /* ... */ });
test.each(['/api/agenda/interno/citas-para-recordatorio', '/api/identidad/interno/x', '/api/agenda/interno'])('gateway bloquea %s', (ruta) => { /* clasificarRuta → bloqueada/404 */ });
test('CitaEstadoCambiado acepta pideCambio y origen opcionales y sigue siendo v1', () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/platform --filter=@consultorio/contracts --filter=@consultorio/svc-agenda --filter=@consultorio/svc-identidad --filter=@consultorio/gateway` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces. Agregar `TOKEN_INTERNO` a compose (agenda e identidad), `generar-dev-env.sh` (genera 48 caracteres aleatorios si falta) y `.env.example`.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando, luego `docker compose --profile app up -d --build --wait` y `pnpm --filter @consultorio/e2e test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): rutas internas protegidas con token y contratos de recordatorios`.

---

### Task 2: Agenda · "pide cambio" y respuestas del paciente

**Files:**
- Create: `apps/svc-agenda/migrations/002_pide_cambio.sql`, `apps/svc-agenda/src/dominio/respuestas.ts`
- Modify: `apps/svc-agenda/src/{consumidor.ts,datos/citas.ts,rutas/citas.ts,rutas/interno.ts}`, `packages/contracts/src/api/agenda.ts`
- Test: `apps/svc-agenda/test/unit/respuestas.test.ts`, `apps/svc-agenda/test/integration/{respuestas,citas}.test.ts`

**Interfaces:**
- Consumes: Task 1 (`CitaRespuestaPaciente`, campos opcionales de eventos).
- Produces:
  - Migración 002: `cita.pide_cambio boolean NOT NULL DEFAULT false`. `citaSchema` agrega `pideCambio: boolean`. La ruta interna devuelve el valor real.
  - `decidirRespuesta(cita: { estado; inicio: string; pideCambio }, e: { respuesta; inicioCita }): { accion: 'confirmar' | 'cancelar' | 'marcar_cambio' } | { accion: 'ignorar'; motivo: 'reprogramada' | 'estado_final' | 'sin_efecto' }`: `inicio ≠ inicioCita` → ignorar `reprogramada`; estado final (`atendida`, `cancelada`, `no_asistio`) → ignorar `estado_final`; `confirma` sobre `confirmada` → ignorar `sin_efecto`; el resto según `transicionPermitida`.
  - Consumidor: suscribe `evt.cita.respuesta_paciente`; en la transacción del consumidor aplica la acción, sube `version`, y emite `cita.estado_cambiado` (`confirmar`: de `agendada` a `confirmada`, `origen`), `cita.cancelada` (`origen`) o `cita.estado_cambiado` con el mismo estado y `pideCambio: true`. Un `ignorar` solo escribe un log `info` con el motivo (sin datos del paciente). El sobre emitido copia el `actorId` del evento recibido.
  - Reprogramar (`PATCH /citas/:id`) pone `pide_cambio = false`. Las acciones del personal emiten `origen: 'personal'`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test.each([
  [{ estado: 'agendada' }, 'confirma', 'confirmar'], [{ estado: 'confirmada' }, 'cancela', 'cancelar'],
  [{ estado: 'agendada' }, 'pide_cambio', 'marcar_cambio'], [{ estado: 'confirmada' }, 'confirma', 'ignorar'],
])('decidirRespuesta %o %s → %s', (c, r, a) => { /* ... */ });
test('Review Focus 5: cancelar sobre atendida → ignorar estado_final', () => { /* ... */ });
test('respuesta con inicioCita distinto (reprogramada) → ignorar', () => { /* ... */ });
// integración
test('respuesta cancela: la cita queda cancelada, el hueco se libera y se emite cita.cancelada con origen paciente', async () => { /* ... */ });
test('pide_cambio: pideCambio true, version+1, cita.estado_cambiado con pideCambio', async () => { /* ... */ });
test('reentrega del mismo evento no aplica dos veces (inbox)', async () => { /* ... */ });
test('reprogramar limpia pideCambio', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/contracts --filter=@consultorio/svc-agenda` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS con cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(agenda): pide cambio y respuestas del paciente`.

---

### Task 3: `svc-notificaciones` · servicio base, esquema y reglas puras

**Files:**
- Create: `apps/svc-notificaciones/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}` (patrón de `svc-agenda`), `migrations/001_notificaciones.sql`, `src/dominio/{plantillas,token,calendario,whatsapp}.ts`, `src/{server,main}.ts`
- Modify: `docker/postgres/init.sql`, `docker/postgres/init.sh`, `scripts/generar-dev-env.sh`, `.env.example`
- Test: `apps/svc-notificaciones/test/unit/{plantillas,token,calendario,whatsapp,migraciones}.test.ts`, `test/integration/{helpers.ts,aislamiento.test.ts,token.test.ts}`

**Interfaces:**
- Produces:
  - Migración 001 (spec §4.1): `config_recordatorios`, `envio` (con `UNIQUE (tenant_id, cita_id, fecha_cita, canal)` e índice por `(tenant_id, fecha_cita)`), `corrida`, `consultorio`; RLS estándar y `outboxInboxSql('notificaciones_app')`; `fn_envio_por_token(p_hash text) RETURNS TABLE(tenant_id uuid, envio_id uuid)` `SECURITY DEFINER`, dueño `notificaciones_migrator`, `SET search_path = public`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE` a `notificaciones_app`.
  - `PLANTILLAS_POR_OMISION: { correoAsunto; correoCuerpo; whatsapp }` en español; `rellenar(plantilla: string, datos: DatosPlantilla, o: { html: boolean }): string`; `validarPlantillas(p): { ok: true } | { ok: false; campo; error }` (límites de Global Constraints).
  - `generarToken(): { token: string; hash: string }`; `hashDeToken(token: string): string`.
  - `fechaCitaLocal(inicioIso: string, zona: string): string` (`YYYY-MM-DD`); `fechaDeEnvio(fechaCita: string): string` (día anterior); `corridaPendiente(ahora: DateTime, zona: string, horaEnvio: string, ultimaCorrida: string | null): { fechaEnvio: string; fechaCitas: string } | null` (devuelve la corrida de hoy si ya pasó la hora local y no se ha hecho; `fechaCitas` = mañana local); `debeEnviar(envio: { estado }, modo): boolean` (`sin_revision`: `pendiente` o `aprobado`; `con_revision`: solo `aprobado`).
  - `enlaceWhatsApp(telefono: string, pais: CodigoPais, mensaje: string): string | null` (usa `normalizarTelefono`; `https://wa.me/{digitos}?text={encodeURIComponent(mensaje)}`).
  - `buildServer({ pool, jwksUrl, reloj, ... })` con `createHttpApp({ servicio: 'svc-notificaciones' })`; `main.ts` con env `PORT` (3005), `DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `NATS_URL`, `JWKS_URL`, `AGENDA_URL`, `IDENTIDAD_URL`, `TOKEN_INTERNO`, `WEB_ORIGEN`, `SMTP_*`, `S3_*` (aún sin rutas ni programador).
  - Helpers de prueba `iniciarNotificaciones()` (Postgres, NATS, JWKS; dobles para agenda, identidad, correo y almacén inyectables).

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('rellenar sustituye campos, escapa HTML en modo html y deja {desconocido} tal cual', () => {
  expect(rellenar('Hola {paciente} <b>', { paciente: 'Ana & Luis' } as DatosPlantilla, { html: true })).toBe('Hola Ana &amp; Luis &lt;b&gt;');
});
test('validarPlantillas rechaza asunto de 121 caracteres y WhatsApp de 701', () => { /* ... */ });
test('generarToken: 43 caracteres base64url y hash SHA-256 hex de 64', () => { /* ... */ });
test('Review Focus 3: Tijuana sábado 10:05 local → corrida con fechaCitas = domingo; 09:59 → null', () => { /* ... */ });
test('corridaPendiente: ya corrió hoy → null', () => { /* ... */ });
test('debeEnviar: con_revision solo aprobado; sin_revision pendiente y aprobado; nunca enviado/anulado', () => { /* ... */ });
test('enlaceWhatsApp normaliza +52 y devuelve null si el teléfono no es válido', () => { /* ... */ });
test('aislamiento: notificaciones_app no ve envíos de otro tenant', async () => { /* ... */ });
test('fn_envio_por_token encuentra el envío sin tenant fijado y devuelve vacío para un hash desconocido', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm install && pnpm --filter @consultorio/svc-notificaciones test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces (`init.sql`/`init.sh` crean `notificaciones_db` y sus roles; `generar-dev-env.sh` y `.env.example` agregan sus contraseñas).
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS con cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(notificaciones): servicio base, esquema con RLS y reglas puras`.

---

### Task 4: `svc-notificaciones` · consumidor, correo y envío

**Files:**
- Create: `src/externos/{agenda,identidad}.ts`, `src/correo/{canal,smtp,mensaje}.ts`, `src/datos/{config,envios,corridas,consultorios}.ts`, `src/envio.ts`, `src/consumidor.ts`
- Modify: `apps/svc-notificaciones/src/{server,main}.ts`, `package.json` (`nodemailer`, `@types/nodemailer`)
- Test: `test/unit/mensaje.test.ts`, `test/integration/{consumidor,envio}.test.ts`, `packages/platform/src/testing/mailpit.ts` (+ export)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `interface CanalCorreo { enviar(m: { para; asunto; html; texto; adjuntos?: { cid; contenido: Uint8Array; tipo }[] }): Promise<void> }`; `crearCanalSmtp(config)` con `nodemailer` (`SMTP_HOST`, `SMTP_PORT`, auth solo si hay `SMTP_USUARIO`, `SMTP_REMITENTE`).
  - `armarCorreo(i: { plantillas; datos; consultorio; logo?: Uint8Array; enlaces: { confirmar; cancelar; cambiar } }): { asunto; html; texto; adjuntos }` (encabezado con `colorPrimario`/`colorTexto`, logo por `cid:logo` si existe, tres botones, texto plano equivalente).
  - Clientes internos `obtenerCitas(tenantId, desde, hasta)` y `obtenerConsultorio(tenantId)` sobre `llamarInterno`.
  - `enviarCorreo(ctx, tenantId, envioId): Promise<'enviado' | 'fallido' | 'omitido'>`: lee el `envio` y si no `debeEnviar` → `omitido`; pide cita y consultorio; sin correo → `omitido`; genera token nuevo (reemplaza `token_hash`, `token_expira_en` = inicio de la cita) en una transacción corta; envía fuera de transacción; marca `enviado` (`enviado_en`, `enviado_por`) o suma `intentos` y marca `fallido` al tercero. Nunca envía un `envio` ya `enviado`.
  - `asegurarEnvios(ctx, tenantId, desde, hasta)`: crea las filas `pendiente` de correo (solo citas con email) y registra el `consultorio` si falta.
  - Consumidor (`evt.cita.creada`, `evt.cita.reprogramada`, `evt.cita.cancelada`): registra el consultorio; `cita.reprogramada` → `anulado` (y `token_hash = NULL`) los envíos de la fecha anterior; `cita.cancelada` → `anulado` los no enviados. No crea envíos (los crea `asegurarEnvios` al listar o al correr).
  - `startMailpit()` en `@consultorio/platform/testing` (imagen `axllent/mailpit`, SMTP 1025, API 8025) con `mensajes(): Promise<{ para; asunto; html }[]>`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('armarCorreo incluye los tres enlaces, el color y el logo como cid:logo; sin logo no adjunta nada', () => { /* ... */ });
test('enviarCorreo con_revision y pendiente → omitido; aprobado → enviado y llega a Mailpit con los enlaces /r/', async () => { /* ... */ });
test('enviarCorreo dos veces el mismo envío → un solo correo en Mailpit', async () => { /* ... */ });
test('SMTP caído: tres intentos y queda fallido', async () => { /* ... */ });
test('cita sin correo → omitido y sin fila de correo', async () => { /* ... */ });
test('Review Focus 1: reprogramar anula el envío anterior y su token deja de encontrarse', async () => { /* ... */ });
test('el correo y los logs no contienen el teléfono del paciente; la tabla envio no tiene columnas de contacto', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/platform --filter=@consultorio/svc-notificaciones` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS con cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(notificaciones): consumidor de citas y envío de correos`.

---

### Task 5: `svc-notificaciones` · programador automático

**Files:**
- Create: `apps/svc-notificaciones/src/programador.ts`
- Modify: `apps/svc-notificaciones/src/main.ts`
- Test: `test/unit/programador.test.ts`, `test/integration/programador.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  - `iniciarProgramador(ctx, { reloj, intervaloMs = 60_000 }): { detener(): Promise<void>; correrAhora(): Promise<void> }`: en cada vuelta toma `pg_try_advisory_lock(<constante del servicio>)`; si no lo obtiene, no hace nada. Para cada consultorio, con su config (o los valores por omisión) evalúa `corridaPendiente`; si aplica: `asegurarEnvios(mañana)`, `enviarCorreo` para cada envío que `debeEnviar`, e inserta `corrida` solo si las llamadas internas respondieron. Errores de un consultorio no detienen a los demás.
  - Envío inmediato: cuando el consumidor ve `cita.creada`/`cita.reprogramada` para mañana y ya pasó la hora de envío local de hoy, en `sin_revision` llama `asegurarEnvios` + `enviarCorreo` para esa cita.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('antes de la hora no envía; a las 10:00 locales envía los aprobados de mañana y registra la corrida', async () => { /* reloj fijo */ });
test('Review Focus 2: dos programadores a la vez (dos instancias) → cada correo sale una vez', async () => { /* Promise.all(correrAhora x2) */ });
test('Review Focus 3: domingo 10:00 America/Tijuana envía las citas del lunes', async () => { /* ... */ });
test('sin_revision envía los pendientes; con_revision deja "Sin aprobar" sin enviar', async () => { /* ... */ });
test('agenda caída: no registra corrida y la siguiente vuelta lo reintenta', async () => { /* ... */ });
test('cita creada para mañana después de la corrida en sin_revision → sale de inmediato', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/svc-notificaciones test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS con cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(notificaciones): programador automático de recordatorios`.

---

### Task 6: `svc-notificaciones` · API, respuestas del paciente, gateway y compose

**Files:**
- Create: `apps/svc-notificaciones/src/rutas/{recordatorios,config,respuestas}.ts`
- Modify: `apps/svc-notificaciones/src/server.ts`, `packages/contracts/src/api/notificaciones.ts`, `apps/gateway/src/{rutas.ts,config.ts}`, `docker-compose.yml`, `scripts/generar-dev-env.sh`, `.env.example`
- Create: `tests/e2e/test/recordatorios.e2e.test.ts`
- Test: `apps/svc-notificaciones/test/integration/{recordatorios,config,respuestas}.test.ts`, `apps/gateway/test/unit/{rutas,config}.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces (spec §4.8, esquemas en `api/notificaciones.ts`):
  - `GET /recordatorios?desde&hasta` (admin o recepción; ≤ 7 días) → `{ modo, horaEnvio, citas: RecordatorioCita[] }` con `{ citaId, fecha, inicio, paciente, medico, estadoCita, pideCambio, correo: { estado: 'sin_correo' | 'pendiente' | 'aprobado' | 'enviado' | 'fallido' | 'anulado', sinAprobarYVencido: boolean, vistaPrevia: { asunto, texto } | null }, whatsapp: { abierto: boolean, enlace: string | null, motivo: 'telefono_invalido' | null, vistaPrevia: string }, respuesta: Respuesta | null }`. Llama `asegurarEnvios` antes de responder.
  - `POST /recordatorios/:citaId/aprobar` y `POST /recordatorios/aprobar { desde, hasta }` → marcan `aprobado` (con `aprobado_por`); si ya pasó la hora de envío local de hoy y la cita es mañana, envían en ese momento.
  - `POST /recordatorios/:citaId/whatsapp` → registra "WhatsApp abierto" y devuelve `{ enlace }`; `POST /recordatorios/:citaId/respuesta { respuesta }` → actualiza el `envio` del canal correspondiente y emite `CitaRespuestaPaciente` (`origen: 'recepcion'`, `actorId` = usuario); `POST /recordatorios/:citaId/reintentar` → `enviarCorreo` de un `fallido`.
  - `GET /config` (admin o recepción) y `PUT /config` (admin; modo, horaEnvio `HH:mm`, plantillas con `validarPlantillas`) → emite `ConfigRecordatoriosActualizada` con los campos cambiados; guarda la zona del consultorio.
  - Públicas: `GET /respuestas/:token` → `{ estado: 'vigente' | 'respondida' | 'invalida', consultorio?, fecha?, hora?, medico?, telefonoConsultorio? }` (inválida/anulada/vencida → `invalida` sin más datos); `POST /respuestas/:token { respuesta }` → registra (un solo uso, en transacción con `FOR UPDATE`), emite `CitaRespuestaPaciente` (`origen: 'paciente'`, `actorId` null) → `{ estado: 'registrada' | 'respondida' | 'invalida' }`.
  - Gateway: servicio `notificaciones` (`NOTIFICACIONES_URL`); reglas abiertas `GET` y `POST` `/api/notificaciones/respuestas/*` con el límite público por IP.
  - Compose: `svc-notificaciones` (3005), `mailpit` (puertos `8025:8025` publicado para ver el buzón; SMTP 1025 solo en la red interna), variables `TOKEN_INTERNO`, `WEB_ORIGEN`, `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_REMITENTE=recordatorios@consultorio.local`, `S3_*` de solo lectura (mismas credenciales MinIO en local), y `NOTIFICACIONES_URL` en el gateway.
  - E2E de API: registrar consultorio, configurar médico/horario/tipo, `PUT /config` con `horaEnvio: '00:00'`, crear una cita para **mañana** con email, `GET /recordatorios`, aprobarla (como ya pasó la hora de envío de hoy, la aprobación la envía de inmediato), leer el correo en la API de Mailpit (`http://localhost:8025/api/v1/messages`), extrae el token, `POST /api/notificaciones/respuestas/{token}` `{ respuesta: 'confirma' }` y espera (`vi.waitFor`) a que la cita quede `confirmada`; un segundo POST responde `respondida`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('GET /recordatorios combina citas y estados sin exponer columnas de contacto en la base', async () => { /* ... */ });
test('recepción aprueba; médico no admin ni recepción → 403', async () => { /* ... */ });
test('respuesta por WhatsApp registrada por recepción emite cita.respuesta_paciente origen recepcion', async () => { /* ... */ });
test('PUT /config: plantilla de 1001 caracteres → 400; recepción → 403; cambio emite config_recordatorios.actualizada', async () => { /* ... */ });
test('GET /respuestas/:token inválido → { estado: invalida } sin datos', async () => { /* ... */ });
test('POST /respuestas/:token dos veces → registrada y luego respondida; dos simultáneos → uno registrada', async () => { /* ... */ });
test('gateway: /api/notificaciones/respuestas/* es pública; /api/notificaciones/recordatorios exige JWT', () => { /* ... */ });
// e2e
test('flujo completo: aprobar → correo en Mailpit → confirmar → cita confirmada', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/contracts --filter=@consultorio/svc-notificaciones --filter=@consultorio/gateway` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando, luego `docker compose --profile app down -v && docker compose --profile app up -d --build --wait && pnpm --filter @consultorio/e2e test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(notificaciones): API de recordatorios, respuestas del paciente, gateway y compose`.

---

### Task 7: Sitio web · Recordatorios, configuración, respuesta del paciente y "Mi día"

**Files:**
- Create: `apps/web/src/features/recordatorios/**`, `apps/web/src/features/mi-dia/**`, `apps/web/src/features/respuesta/**`, `apps/web/src/features/consultorio/components/SeccionRecordatorios.tsx`, `apps/web/src/app/(app)/{recordatorios,mi-dia}/page.tsx`, `apps/web/src/app/r/[token]/page.tsx`
- Modify: `apps/web/src/proxy.ts` (ruta pública `/r/*`), `apps/web/src/features/navegacion/**`, `apps/web/src/features/agenda/**` (marca "Pide cambio"), `apps/web/src/features/bitacora/logica/acciones.ts`, `apps/web/src/app/(app)/consultorio/page.tsx`
- Test: `apps/web/test/unit/features/{recordatorios,mi-dia,respuesta,consultorio,agenda,bitacora,navegacion}/**`, `apps/web/test/unit/lib/proxy.test.ts`

**Interfaces:**
- Consumes: Task 6 (API y esquemas), Task 2 (`pideCambio`).
- Produces:
  - **Recordatorios** (admin y recepción): mañana + 2 días agrupados por fecha y médico; por cita: vista previa, estado con los textos de Global Constraints, "Aprobar" / "Aprobar todos", "Abrir WhatsApp" (llama la acción que registra y luego `window.open(enlace, '_blank', 'noopener')`), botones "Confirmó" / "Canceló" / "Pide cambio", "Reintentar"; arriba, modo y hora.
  - **Mi consultorio → Recordatorios** (admin edita; recepción no ve la sección): asunto, cuerpo y WhatsApp con la lista de campos y vista previa con datos de ejemplo (reutiliza la lógica de `rellenar` copiada a `features/consultorio/logica/plantillas.ts` con su prueba; la autoridad es el servidor), hora, modo con los textos "Con revisión: solo se envía lo aprobado" / "Sin revisión: todo se envía solo".
  - **`/r/[token]`** (pública, sin layout de la app): muestra consultorio, fecha, hora y médico; tres botones; `?accion=` solo preselecciona; el registro ocurre únicamente con el botón "Enviar respuesta" (server action → `POST /api/notificaciones/respuestas/{token}`). Estados: vigente, respondida (texto exacto con teléfono), inválida (texto exacto), registrada ("Gracias, recibimos tu respuesta").
  - **Mi día** (`/mi-dia`): `GET /api/agenda/citas` de hoy en la zona del consultorio (`obtenerContexto().consultorio.zonaHoraria`) y de los próximos 7 días filtrando `agendada`; un médico ve las suyas (`medicoId = claims.sub`); admin y recepción eligen médico; diseño para celular; "Pide cambio" visible. En el menú, primero para médicos.
  - Agenda: calendario y lista del día marcan "Pide cambio".
  - Bitácora: etiquetas "Cita confirmada por el paciente", "Cita cancelada por el paciente", "Paciente pide cambio" (con "(registrado por recepción)" cuando `origen = 'recepcion'`) y "Recordatorios configurados".

- [ ] **Step 1: Escribir las pruebas que fallan**

```tsx
test('Recordatorios: "Sin aprobar — no se envió" cuando sinAprobarYVencido; "Sin correo — usa WhatsApp" sin correo', async () => { /* ... */ });
test('Abrir WhatsApp registra antes de abrir la pestaña y muestra "WhatsApp abierto"', async () => { /* ... */ });
test('Review Focus 4: /r/[token]?accion=cancela solo preselecciona; sin clic no se llama al gateway', async () => { /* ... */ });
test('/r/[token]: inválido → "Este enlace ya no es válido"; respondida → texto con teléfono del consultorio', async () => { /* ... */ });
test('proxy deja pasar /r/abc sin sesión', async () => { /* ... */ });
test('Mi día: médico ve solo sus citas de hoy en la zona del consultorio y las agendadas de 7 días', async () => { /* ... */ });
test('SeccionRecordatorios: vista previa rellena campos; plantilla de 1001 caracteres muestra error', async () => { /* ... */ });
test('bitácora: cita.cancelada con origen paciente → "Cita cancelada por el paciente"', () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/web test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm --filter @consultorio/web typecheck lint test build` — Expected: PASS con cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(web): recordatorios, respuesta del paciente y mi día`.

---

### Task 8: E2E de navegador, infraestructura (solo código) y documentación

**Files:**
- Create: `tests/e2e-web/test/recordatorios.spec.ts`
- Modify: `infra/lib/{datos,servicios}.ts`, `infra/bin/app.ts` (estimación de costo), `infra/test/infra.test.ts`, `README.md`, `.github/workflows/ci.yml` (si el job e2e necesita Mailpit, ya viene en compose)
- Test: el spec de Playwright e `infra/test/infra.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - Playwright: la encargada configura la hora a `00:00` en "Mi consultorio", crea una cita para mañana con correo, la aprueba en "Recordatorios" (sale el correo), el test lee el enlace en la API de Mailpit, abre `/r/{token}` como paciente (contexto sin sesión), elige "Cancelar", confirma y ve "Gracias, recibimos tu respuesta"; de vuelta en la agenda la cita aparece cancelada. Un médico abre "Mi día" en viewport de 375 px y ve su cita de hoy.
  - Infra: servicio Fargate `svc-notificaciones` (3005, solo accesible desde el gateway), base `notificaciones_db` documentada como en las otras, secretos `TOKEN_INTERNO` y SMTP en Secrets Manager inyectados a notificaciones, agenda e identidad (solo el token), permiso de solo lectura `s3:GetObject` sobre `logos/*` y `kms:Decrypt` sobre la llave del bucket; estimación de costo actualizada en `bin/app.ts`. Prohibido `cdk deploy`/`bootstrap`/`aws`.
  - README: sección "Recordatorios" (modos, hora, Mailpit en `http://localhost:8025`, cómo configurar SMTP de un proveedor con capa gratuita para el piloto y la nota de SPF/DKIM), variables nuevas y el orden de despliegue (agenda → identidad → notificaciones → gateway → web).

- [ ] **Step 1: Escribir el spec y las pruebas de infra que fallan.**
- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/infra test` — Expected: FAIL en las nuevas.
- [ ] **Step 3: Implementar** infra y README.
- [ ] **Step 4: Verificación completa.** Run: `pnpm turbo run typecheck lint test --filter='!@consultorio/e2e' --filter='!@consultorio/e2e-web' && docker compose --profile app down -v && docker compose --profile app up -d --build --wait && pnpm --filter @consultorio/e2e test && pnpm --filter @consultorio/e2e-web test` — Expected: todo PASS.
- [ ] **Step 5: Commit** `test(e2e): recordatorios en navegador; infra y docs`.

---

## Criterio de terminado

- Los 7 criterios de éxito de la spec §1 se cumplen y se ven en `http://localhost:3000` y en Mailpit (`http://localhost:8025`).
- Typecheck, lint y pruebas en verde con cobertura ≥ 80% por paquete; E2E de API y de navegador en verde.
- Revisión de cada tarea y revisión final sin hallazgos importantes abiertos.
- Costo $0.
