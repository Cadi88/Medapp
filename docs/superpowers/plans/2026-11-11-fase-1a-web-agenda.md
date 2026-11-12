# Fase 1 · Entrega 1 — Sitio web + agenda interna — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un consultorio puede registrarse, entrar con MFA, administrar a su equipo, configurar horarios y tipos de cita, y manejar su agenda (crear, reprogramar, cambiar el estado de citas) desde un sitio web, con la bitácora visible para el admin.

**Architecture:** Se extiende la plataforma de la Fase 0. Identidad cambia a "rol de trabajo + permiso admin" y agrega la contraseña temporal y los endpoints de lectura. Un nuevo microservicio `svc-agenda` (Fastify, `agenda_db` con RLS, outbox/inbox) es dueño de tipos de cita, horarios, bloqueos y citas, y mantiene una copia local de los médicos a partir de los eventos de identidad. `apps/web` (Next.js) actúa como intermediario: el navegador solo habla con Next, Next guarda la sesión y el JWT en cookies httpOnly y llama al gateway desde el servidor.

**Tech Stack:** Lo de la Fase 0 (Node 24, TypeScript estricto ESM, pnpm + Turborepo, Fastify 5, Zod 4, `pg`, NATS JetStream, Better Auth, `jose`, Vitest, Testcontainers) más Luxon (zonas horarias), Next.js ≥ 16 (App Router, `output: 'standalone'`), React 19, Tailwind CSS 4, shadcn/ui, FullCalendar 6 (paquetes MIT `@fullcalendar/{core,react,daygrid,timegrid,interaction,list}`), `qrcode` (QR del TOTP), Testing Library + jsdom y Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-fase-1a-web-agenda-design.md` (y la spec general `2026-11-10-saas-consultorios-design.md`)

## Global Constraints

- Todas las Global Constraints del plan de la Fase 0 (`docs/superpowers/plans/2026-11-10-fase-0-plataforma.md`) siguen vigentes, salvo la línea de roles, que se reemplaza por la siguiente.
- **Roles:** `rol ∈ {medico, recepcion}` + `admin: boolean`. MFA obligatorio si `rol = 'medico'` o `admin = true`. Un consultorio nunca se queda sin `admin = true`.
- Claims del JWT del tenant: `{ sub, tid, rol, admin, mfa }`; `issuer: 'svc-identidad'`, expira en 15 min.
- **Capas:** el código nuevo de servicios separa `src/dominio/` (funciones puras), `src/rutas/` (HTTP) y `src/datos/` (SQL). ESLint prohíbe que `apps/*/src/dominio/**` importe `pg`, `fastify`, `@nats-io/*` o `@consultorio/platform`.
- **ACID:** toda escritura va en `withTenant`, con el evento en el outbox dentro de la misma transacción. Las invariantes críticas (sin doble reserva, horarios sin encimarse, duración válida) viven en la base como `EXCLUDE`, `CHECK` o `UNIQUE`.
- **Inyección de dependencias:** `buildServer(deps)` recibe `pool`, `jwksUrl` y, cuando aplique, `reloj: () => Date`. El dominio nunca llama a `new Date()` directamente: recibe la hora como parámetro.
- ESLint `@typescript-eslint/no-explicit-any: error` en todo el repo.
- Eventos nuevos versionados en `packages/contracts`. Un cambio incompatible crea una versión nueva y los consumidores aceptan ambas.
- Ni los eventos ni los logs llevan datos de contacto del paciente (nombre, teléfono, email).
- Errores nuevos (`ErrorCode`): `PASSWORD_TEMPORAL` (403), `FUERA_DE_HORARIO` (422), `HORARIO_OCUPADO` (409), `HORARIO_BLOQUEADO` (409), `CONFLICTO_VERSION` (409).
- `svc-agenda`: puerto **3004**, consumidor durable `agenda`. `web`: puerto **3000**.
- `apps/web`: cobertura ≥ 80% de líneas y ramas medida sobre `src/lib/**`, `src/features/**` (excluye `src/app/**`, rutas delgadas que cubre Playwright, y `src/components/ui/**`, generado por shadcn). Proyecto `unit` con jsdom; sin proyecto `integration` (`test:integration` con `--passWithNoTests`).
- Interfaz en español; fechas con `Intl`/Luxon en `es-MX` y en la zona horaria del consultorio.
- **$0:** nada se despliega; `infra/` se actualiza solo como código. Ningún paso ejecuta `cdk deploy`, `cdk bootstrap` ni la CLI de `aws`.
- **Puntos de control:** cada tarea termina en un commit, con la suite del paquete en verde. Si la sesión se interrumpe, se retoma desde el último commit y el ledger de ejecución.

## Review Focus

1. **Cita que cruza un cambio de horario o la medianoche local** (por ejemplo, Tijuana el día del cambio de horario, o una cita de 23:30 a 00:30) → se valida contra el bloque del día local correcto y nunca se acepta a medias. Prueba en Task 6.
2. **Dos pestañas o dos recepcionistas reprogramando la misma cita** → la segunda recibe `409 CONFLICTO_VERSION` y la cita queda con un solo cambio. Prueba en Task 8.
3. **Admin que se quita a sí mismo el permiso admin, o dos admins quitándoselo a la vez** → nunca queda el consultorio sin admin (409). Prueba en Task 3.
4. **JWT del tenant que expira mientras el usuario tiene la agenda abierta** → la siguiente acción renueva el token sin perder lo capturado; si la sesión venció, lleva a `/login`. Prueba en Task 10.
5. **Médico que pide la disponibilidad o las citas de otro médico cambiando el id en la URL** → `403 PROHIBIDO`, sin filtrar datos. Prueba en Task 7 y Task 8.

---

## Mapa de archivos

```
packages/contracts/src/
  auth.ts                       rolSchema (medico|recepcion), tokenClaimsSchema (+admin)
  errors.ts                     + 5 ErrorCode
  events/identidad.ts           UsuarioVinculado v2, MiembroActualizado
  events/agenda.ts              CitaCreada, CitaReprogramada, CitaCancelada, CitaEstadoCambiado
  api/agenda.ts                 Esquemas de petición/respuesta de svc-agenda
  api/identidad.ts              Esquemas de respuesta de los endpoints de lectura de identidad
packages/platform/src/http/plugin.ts   RequestCtx.admin, requireAdmin()
apps/svc-identidad/
  migrations/003_roles_admin.sql, 004_password_temporal.sql
  src/dominio/reglas.ts         (movido desde src/reglas.ts) exigeMfa, decidirToken, puedeQuitarAdmin
  src/routes/{miembros,consultorio,sesion,registro}.ts
apps/svc-auditoria/src/{consulta.ts, routes/eventos.ts}   cursor antesDe + filtro accion
apps/svc-agenda/
  migrations/001_agenda.sql
  src/dominio/{estados,horario,disponibilidad,permisos,tiempo}.ts
  src/datos/{medicos,tipos-cita,horario,bloqueos,citas}.ts
  src/rutas/{medicos,tipos-cita,horario,bloqueos,disponibilidad,citas}.ts
  src/{consumidor,server,main}.ts
apps/gateway/src/{rutas.ts,config.ts}                     + servicio agenda
apps/web/
  next.config.ts, vitest.config.ts, src/proxy.ts
  src/lib/api/{gateway.ts,resultado.ts}
  src/lib/sesion/{cookies.ts,token.ts,desvios.ts}
  src/features/{sesion,agenda,medicos,equipo,perfil,bitacora}/{components,actions.ts,logica,api.ts}
  src/app/**                    Rutas delgadas
  src/components/ui/**          shadcn/ui
docker/{Dockerfile.web, postgres/init.sql, postgres/init.sh}, docker-compose.yml, scripts/generar-dev-env.sh, .env.example
tests/e2e/test/agenda.e2e.test.ts                          E2E de API
tests/e2e-web/                                             Playwright
infra/lib/{datos,servicios}.ts, infra/test/infra.test.ts
.github/workflows/ci.yml, README.md, eslint.config.js
```

---

### Task 1: Modelo de roles — rol de trabajo + permiso admin

**Files:**
- Modify: `packages/contracts/src/{auth.ts,errors.ts,events/identidad.ts,index.ts}`, `packages/platform/src/http/plugin.ts`, `packages/platform/src/index.ts`
- Create: `apps/svc-identidad/migrations/003_roles_admin.sql`
- Move: `apps/svc-identidad/src/reglas.ts` → `apps/svc-identidad/src/dominio/reglas.ts` (y sus importaciones)
- Modify: `apps/svc-identidad/src/{tokens.ts,actor.ts,validadores.ts,routes/registro.ts,routes/sesion.ts,routes/miembros.ts,routes/perfil.ts,routes/datos-fiscales.ts}`, `apps/svc-auditoria/src/routes/eventos.ts`, `tests/e2e/test/cliente.ts`, `eslint.config.js`
- Test: `packages/contracts/test/unit/auth.test.ts`, `packages/platform/test/unit/require-admin.test.ts`, `apps/svc-identidad/test/unit/reglas.test.ts`, `apps/svc-identidad/test/integration/{registro,sesion,miembros}.test.ts`, `apps/svc-identidad/test/unit/migraciones.test.ts`

**Interfaces:**
- Consumes: Fase 0.
- Produces:
  - `rolSchema = z.enum(['medico', 'recepcion'])`; `tokenClaimsSchema = { sub, tid, rol, admin: z.boolean(), mfa }`.
  - `errorCodeSchema` + `'PASSWORD_TEMPORAL' | 'FUERA_DE_HORARIO' | 'HORARIO_OCUPADO' | 'HORARIO_BLOQUEADO' | 'CONFLICTO_VERSION'`.
  - `UsuarioVinculado = defineEvent('usuario.vinculado', 2, { usuarioId, nombre: z.string(), rol, admin: z.boolean() })`; se exporta `UsuarioVinculadoV1` (el esquema anterior, para los consumidores). `MiembroActualizado = defineEvent('miembro.actualizado', 1, { usuarioId, nombre, rol, admin })`.
  - `RequestCtx` + `admin: boolean`; `requireAdmin(): preHandler` → sin ctx 401 `NO_AUTENTICADO`; `admin !== true` → 403 `PROHIBIDO`.
  - `exigeMfa(m: { rol: Rol; admin: boolean }): boolean`; `decidirToken({ rol, admin, twoFactorEnabled })`; `puedeQuitarAdmin(i: { esAdminObjetivo: boolean; admins: number }): boolean` (reemplaza a `puedeEliminarMiembro`, la usan tanto `DELETE` como, en la Task 3, `PATCH`).
  - Migración 003: `membresia.admin boolean NOT NULL DEFAULT false`; `UPDATE membresia SET rol='medico', admin=true WHERE rol='admin'`; nuevo `CHECK (rol IN ('medico','recepcion'))`. `fn_membresias_usuario` devuelve además `admin`.
  - `POST /registro` body agrega `esMedico: boolean` → fundador con `rol = esMedico ? 'medico' : 'recepcion'`, `admin = true`.
  - `POST /miembros` body `{ nombre, email, rol, admin: boolean, passwordTemporal }`.
  - `GET /tenants/mios` → `[{ tenantId, nombre, slug, rol, admin }]`.
  - ESLint: regla `no-restricted-imports` para `apps/*/src/dominio/**` (pg, fastify, @nats-io/*, @consultorio/platform) y `no-explicit-any: error` global.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
// reglas.test.ts
test.each([
  [{ rol: 'medico', admin: false }, true], [{ rol: 'recepcion', admin: true }, true], [{ rol: 'recepcion', admin: false }, false],
])('exigeMfa(%o) = %s', (m, esperado) => expect(exigeMfa(m)).toBe(esperado));
test('no se puede quitar al último admin', () => {
  expect(puedeQuitarAdmin({ esAdminObjetivo: true, admins: 1 })).toBe(false);
  expect(puedeQuitarAdmin({ esAdminObjetivo: true, admins: 2 })).toBe(true);
  expect(puedeQuitarAdmin({ esAdminObjetivo: false, admins: 1 })).toBe(true);
});
// require-admin.test.ts
test('requireAdmin: admin=false → 403 PROHIBIDO; sin ctx → 401', async () => { /* ... */ });
// registro.test.ts
test('registro con esMedico=true crea membresía medico+admin y emite usuario.vinculado v2', async () => {
  const r = await registrar('uno', { esMedico: true });
  const m = await migrator.query('select rol, admin from membresia where tenant_id=$1', [r.tenantId]);
  expect(m.rows).toEqual([{ rol: 'medico', admin: true }]);
  const ev = await ultimoEvento('usuario.vinculado');
  expect(ev).toMatchObject({ version: 2, data: { rol: 'medico', admin: true, nombre: 'Admin' } });
});
test('registro sin esMedico → 400 VALIDACION', async () => { /* ... */ });
// sesion.test.ts
test('token incluye admin y rol de trabajo', async () => {
  expect(payload).toMatchObject({ rol: 'medico', admin: true, mfa: true });
});
test('recepción admin sin MFA → 403 MFA_REQUERIDA', async () => { /* ... */ });
// miembros.test.ts
test('recepción no admin no puede dar de alta miembros → 403', async () => { /* ... */ });
test('no se puede eliminar al último admin → 409', async () => { /* ... */ });
// migraciones.test.ts
test('003 convierte admin en medico+admin', async () => { /* aplica 001-002, inserta rol admin, aplica 003, verifica */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/contracts --filter=@consultorio/platform --filter=@consultorio/svc-identidad` — Expected: FAIL en las nuevas.
- [ ] **Step 3: Implementar** según Interfaces. `svc-auditoria` cambia `requireRole('admin')` por `requireAdmin()`. `tests/e2e/test/cliente.ts` envía `esMedico: true` en el registro.
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm turbo run typecheck lint test --filter='!@consultorio/e2e'` — Expected: PASS y cobertura ≥ 80%.
- [ ] **Step 5: E2E de la Fase 0 sigue en verde.** Run: `docker compose --profile app up -d --build --wait && pnpm --filter @consultorio/e2e test` — Expected: 5 passed.
- [ ] **Step 6: Commit** `feat(identidad): rol de trabajo + permiso admin`.

---

### Task 2: Identidad · contraseña temporal

**Files:**
- Create: `apps/svc-identidad/migrations/004_password_temporal.sql`
- Modify: `apps/svc-identidad/src/{auth.ts,routes/sesion.ts,routes/miembros.ts}`; create `apps/svc-identidad/src/dominio/password-temporal.ts`
- Test: `apps/svc-identidad/test/unit/password-temporal.test.ts`, `apps/svc-identidad/test/integration/password-temporal.test.ts`

**Interfaces:**
- Consumes: Task 1 (`decidirToken`, `requireAdmin`, `PASSWORD_TEMPORAL`).
- Produces:
  - Columna `"user"."debeCambiarPassword" boolean NOT NULL DEFAULT false`, declarada en Better Auth como `user.additionalFields.debeCambiarPassword` (`input: false`).
  - `decidirToken` recibe además `debeCambiarPassword: boolean` → `{ ok: false, motivo: 'PASSWORD_TEMPORAL' | 'MFA_REQUERIDA' }`. `PASSWORD_TEMPORAL` tiene prioridad.
  - `POST /sesion/tenant` → 403 `PASSWORD_TEMPORAL` mientras la bandera esté activa.
  - Hook `hooks.after` de Better Auth en `/change-password`: si la respuesta fue exitosa, pone la bandera en `false` y revoca las otras sesiones (`revocarSesiones`, ya existe).
  - `POST /miembros` deja la bandera en `true` **solo** cuando crea la cuenta.
  - `POST /miembros/:usuarioId/password-temporal` (`requireAdmin`) body `{ passwordTemporal: string(min 10) }` → 204. Reglas (`puedeReiniciarPassword(i: { esMiembro: boolean; otrosConsultorios: number }): 'ok' | 'no_encontrado' | 'compartida'`): no miembro → 404; con membresías en otro consultorio → 409 `CONFLICTO`. Si procede, fija la contraseña con la utilidad de hash de Better Auth (`(await auth.$context).password.hash`) sobre `account.password` del proveedor `credential`, activa la bandera y revoca todas sus sesiones.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('miembro nuevo con contraseña temporal → 403 PASSWORD_TEMPORAL al pedir token', async () => { /* ... */ });
test('tras change-password obtiene token y se revocan sus otras sesiones', async () => { /* ... */ });
test('vincular un usuario existente no activa la bandera', async () => { /* ... */ });
test('reinicio por admin: activa bandera, revoca sesiones, la contraseña nueva funciona', async () => { /* ... */ });
test('reinicio de cuenta compartida con otro consultorio → 409', async () => { /* ... */ });
test('reinicio de usuario de otro consultorio → 404', async () => { /* ... */ });
test('recepción no admin no puede reiniciar → 403', async () => { /* ... */ });
// unit
test('PASSWORD_TEMPORAL tiene prioridad sobre MFA_REQUERIDA', () => {
  expect(decidirToken({ rol: 'medico', admin: false, twoFactorEnabled: false, debeCambiarPassword: true }))
    .toEqual({ ok: false, motivo: 'PASSWORD_TEMPORAL' });
});
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/svc-identidad test` — Expected: FAIL en las nuevas.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS y cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(identidad): contraseña temporal y reinicio por admin`.

---

### Task 3: Identidad · lecturas y edición de miembros

**Files:**
- Create: `apps/svc-identidad/src/routes/consultorio.ts`, `packages/contracts/src/api/identidad.ts`
- Modify: `apps/svc-identidad/src/{server.ts,routes/miembros.ts}`, `packages/contracts/src/index.ts`
- Test: `apps/svc-identidad/test/integration/{consultorio,miembros-edicion}.test.ts`, `packages/contracts/test/unit/api-identidad.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 (`puedeQuitarAdmin`, `MiembroActualizado`).
- Produces (esquemas Zod en `api/identidad.ts`, reutilizados por `apps/web`):
  - `consultorioSchema = { id, nombre, slug, zonaHoraria }` → `GET /consultorio` (cualquier miembro).
  - `miembroSchema = { usuarioId, nombre, email, rol, admin, mfaActivo, debeCambiarPassword, perfilMedico: { cedulaProfesional, especialidad, cedulaEspecialidad, institucion } | null }`; `GET /miembros` → `{ miembros: Miembro[] }` (cualquier miembro), ordenado por nombre.
  - `PATCH /miembros/:usuarioId` (`requireAdmin`) body `{ rol?, admin? }` (al menos uno) → 200 `Miembro`. Bloquea las membresías admin (`FOR UPDATE`) y aplica `puedeQuitarAdmin` cuando `admin: false` sobre un admin → 409 `CONFLICTO`. Emite `MiembroActualizado` en la misma transacción. Si el rol queda en `recepcion`, conserva `perfil_medico`.
  - El nombre y el email de `GET /miembros` salen de `"user"`, consultado junto con `membresia` (el rol `identidad_app` ya lee `"user"`).

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('GET /miembros lista solo los del consultorio, con perfil médico', async () => { /* ... */ });
test('GET /consultorio devuelve zona horaria', async () => { /* ... */ });
test('PATCH cambia rol y emite miembro.actualizado', async () => {
  const r = await patch(adminToken, recepcion.id, { rol: 'medico' });
  expect(r.json()).toMatchObject({ rol: 'medico' });
  expect(await ultimoEvento('miembro.actualizado')).toMatchObject({ data: { usuarioId: recepcion.id, rol: 'medico', admin: false } });
});
test('Review Focus 3: el único admin no puede quitarse admin → 409', async () => { /* ... */ });
test('Review Focus 3: dos admins quitándose admin a la vez → uno 200, otro 409; queda 1 admin', async () => {
  const [a, b] = await Promise.all([patch(tokA, adminA, { admin: false }), patch(tokB, adminB, { admin: false })]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  expect((await migrator.query('select count(*)::int n from membresia where admin')).rows[0].n).toBe(1);
});
test('PATCH vacío → 400; recepción no admin → 403; usuario de otro consultorio → 404', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/contracts --filter=@consultorio/svc-identidad` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(identidad): consultorio, lista y edición de miembros`.

---

### Task 4: Auditoría · paginación y filtro por acción

**Files:**
- Modify: `apps/svc-auditoria/src/{consulta.ts,routes/eventos.ts}`
- Test: `apps/svc-auditoria/test/unit/consulta.test.ts`, `apps/svc-auditoria/test/integration/eventos.test.ts`

**Interfaces:**
- Consumes: Task 1 (`requireAdmin`).
- Produces: `GET /eventos?desde&hasta&accion&antesDe&limite` → `{ eventos, siguiente: number | null }`.
  - `antesDe`: entero positivo (secuencia), filtra `secuencia < antesDe`.
  - `accion`: `/^[a-z_]+(\.[a-z_]+)+$/`, igualdad exacta.
  - `siguiente`: la `secuencia` del último evento si se devolvieron `limite` filas; si no, `null`.
  - El cursor usa `secuencia` (no `id`), porque es el orden de la cadena. En la spec §2.5 se actualiza `antesDe=<id>` a `antesDe=<secuencia>`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('construirListado agrega accion y antesDe parametrizados', () => {
  const { text, values } = construirListado(T, { accion: 'cita.creada', antesDe: 10, limite: 50 });
  expect(text).toContain('accion = $2'); expect(text).toContain('secuencia < $3'); expect(values).toEqual([T, 'cita.creada', 10, 50]);
});
test.each([['accion inválida', { accion: 'DROP TABLE' }], ['antesDe negativo', { antesDe: '-1' }]])('%s → ZodError', (_n, q) => { /* ... */ });
test('paginar 120 eventos de 50 en 50 los recorre todos sin repetir', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/svc-auditoria test` — Expected: FAIL.
- [ ] **Step 3: Implementar** y actualizar la línea de la spec §2.5.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(auditoria): paginación por cursor y filtro por acción`.

---

### Task 5: `svc-agenda` · esquema, servicio base y copia local de médicos

**Files:**
- Create: `apps/svc-agenda/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}` (copiados del patrón de `svc-auditoria`, nombre `@consultorio/svc-agenda`, más la dependencia `luxon` y `@types/luxon`)
- Create: `apps/svc-agenda/migrations/001_agenda.sql`, `apps/svc-agenda/src/{server.ts,main.ts,consumidor.ts}`, `apps/svc-agenda/src/datos/medicos.ts`, `apps/svc-agenda/src/dominio/medicos.ts`
- Test: `apps/svc-agenda/test/unit/{migraciones,medicos}.test.ts`, `apps/svc-agenda/test/integration/{helpers.ts,aislamiento.test.ts,consumidor.test.ts}`

**Interfaces:**
- Consumes: Task 1 (eventos v2, `MiembroActualizado`, `UsuarioVinculadoV1`).
- Produces:
  - `001_agenda.sql`: `CREATE EXTENSION IF NOT EXISTS btree_gist` y las tablas de la spec §3.1, todas con `rlsPolicySql` y `outboxInboxSql('agenda_app')`:
    - `consultorio(tenant_id pk, zona_horaria text NOT NULL)`
    - `medico(tenant_id, usuario_id, nombre, activo boolean NOT NULL DEFAULT true, pk(tenant_id, usuario_id))`
    - `tipo_cita(id pk, tenant_id, medico_id, nombre, duracion_min int CHECK 5..480, activo default true, FK (tenant_id, medico_id) → medico)` + `UNIQUE INDEX (tenant_id, medico_id, lower(nombre)) WHERE activo`
    - `horario(id pk, tenant_id, medico_id, dia_semana smallint CHECK 0..6, hora_inicio time, hora_fin time, CHECK (hora_inicio < hora_fin), EXCLUDE USING gist (tenant_id WITH =, medico_id WITH =, dia_semana WITH =, tsrange(DATE '2000-01-01' + hora_inicio, DATE '2000-01-01' + hora_fin) WITH &&))`
    - `bloqueo(id pk, tenant_id, medico_id, rango tstzrange NOT NULL CHECK (NOT isempty(rango)), motivo text)`
    - `cita(id pk, tenant_id, medico_id, tipo_cita_id, rango tstzrange, estado text CHECK IN ('agendada','confirmada','atendida','cancelada','no_asistio'), contacto_nombre, contacto_telefono, contacto_email null, notas null, fuera_de_horario boolean, origen text CHECK IN ('recepcion'), creada_por uuid, version int NOT NULL DEFAULT 1, creada_en, actualizada_en)` + `CONSTRAINT cita_sin_traslape EXCLUDE USING gist (tenant_id WITH =, medico_id WITH =, rango WITH &&) WHERE (estado <> 'cancelada')` + índice `(tenant_id, medico_id, lower(rango))`
    - Permisos: `agenda_app` tiene `SELECT, INSERT, UPDATE, DELETE` sobre las tablas de negocio.
  - Dominio: `aplicarEventoMedico(actual: Medico | null, e: { tipo: 'vinculado' | 'actualizado' | 'desvinculado'; nombre?; rol? }): Medico | null`. Regla: `vinculado`/`actualizado` con `rol = 'medico'` → activo con ese nombre; con `recepcion` → si existía, `activo = false`; `desvinculado` → `activo = false`; nunca se borra.
  - `iniciarConsumidor({ pool, nc, logger })`: consumidor `agenda`, subjects `evt.tenant.creado`, `evt.usuario.vinculado`, `evt.miembro.actualizado`, `evt.usuario.desvinculado`. Acepta `usuario.vinculado` v1 (`rol: 'admin'` se trata como `medico`, el nombre queda `''` hasta el siguiente `miembro.actualizado`) y v2. Usa upsert (`ON CONFLICT`).
  - `buildServer({ pool, jwksUrl, reloj }): Promise<FastifyInstance>` con `createHttpApp({ servicio: 'svc-agenda', plugin: { jwksUrl, rutasPublicas: [] } })`. `main.ts`: env `PORT` (3004), `DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `NATS_URL`, `JWKS_URL`; corre migraciones, `ensureStreams`, `startOutboxPublisher`, consumidor y servidor, con apagado ordenado (patrón de `svc-auditoria/src/main.ts`).
  - Helpers de prueba en `test/integration/helpers.ts`: `iniciarAgenda()` → `{ app, appPool, migrator, nats, jwks, tokenPara(claims), sembrarMedico(tenantId, usuarioId, nombre) }`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test.each([
  [null, { tipo: 'vinculado', rol: 'medico', nombre: 'Dra. A' }, { nombre: 'Dra. A', activo: true }],
  [null, { tipo: 'vinculado', rol: 'recepcion', nombre: 'R' }, null],
  [{ nombre: 'Dra. A', activo: true }, { tipo: 'actualizado', rol: 'recepcion', nombre: 'Dra. A' }, { nombre: 'Dra. A', activo: false }],
  [{ nombre: 'Dra. A', activo: true }, { tipo: 'desvinculado' }, { nombre: 'Dra. A', activo: false }],
])('aplicarEventoMedico', (actual, e, esperado) => expect(aplicarEventoMedico(actual, e)).toEqual(esperado));
test('aislamiento: agenda_app no ve ni escribe filas de otro tenant en ninguna tabla', async () => { /* por tabla */ });
test('horarios encimados del mismo médico y día → violación de exclusión', async () => { /* ... */ });
test('consumidor: tenant.creado + usuario.vinculado v2 crean consultorio y médico; reentrega idempotente', async () => { /* ... */ });
test('consumidor: usuario.desvinculado desactiva sin borrar', async () => { /* ... */ });
test('consumidor: usuario.vinculado v1 rol admin crea médico', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm install && pnpm --filter @consultorio/svc-agenda test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS y cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(agenda): servicio base, esquema con RLS y copia local de médicos`.

---

### Task 6: `svc-agenda` · reglas de dominio

**Files:**
- Create: `apps/svc-agenda/src/dominio/{tiempo.ts,estados.ts,horario.ts,disponibilidad.ts,permisos.ts}`
- Test: `apps/svc-agenda/test/unit/{tiempo,estados,horario,disponibilidad,permisos}.test.ts`

**Interfaces:**
- Consumes: `TokenClaims` (Task 1). Sin I/O; la hora llega como parámetro.
- Produces (tipos en `dominio/tipos.ts`: `Rango = { inicio: DateTime; fin: DateTime }` de Luxon en UTC; `BloqueHorario = { diaSemana: 0..6; horaInicio: 'HH:mm'; horaFin: 'HH:mm' }`; `EstadoCita`):
  - `rangoDeCita(inicioIso: string, duracionMin: number): Rango`.
  - `transicionPermitida(de: EstadoCita, a: EstadoCita): boolean` (spec §3.2); `puedeReprogramar(estado): boolean`.
  - `encajaEnHorario(r: Rango, bloques: BloqueHorario[], zona: string): boolean`: convierte a la zona local; el rango debe caber **completo** en un solo bloque del día local de su inicio. Una cita que cruza la medianoche local nunca encaja.
  - `seEnciman(a: Rango, b: Rango): boolean` (semiabierto `[inicio, fin)`).
  - `huecosLibres(i: { fecha: 'YYYY-MM-DD'; zona; bloques; ocupados: Rango[]; duracionMin; ahora: DateTime }): string[]` (ISO UTC). Recorre cada bloque del día de la semana de `fecha` en la zona, paso = `duracionMin`, empezando en `horaInicio`; descarta los que se enciman con `ocupados` (citas no canceladas + bloqueos) o empiezan antes de `ahora`. Las horas locales que no existen por un cambio de horario se omiten y las ambiguas se toman una vez (`DateTime.fromObject(..., { zone })` de Luxon).
  - `puedeGestionarMedico(c: Pick<TokenClaims, 'sub' | 'rol' | 'admin'>, medicoId: string): boolean` → `admin || rol === 'recepcion' || sub === medicoId`.
  - `validarSemana(bloques: BloqueHorario[]): { ok: true } | { ok: false; error: string }`: formato `HH:mm`, inicio < fin, sin encimarse en el mismo día. Es la primera barrera; la `EXCLUDE` es la definitiva.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('transiciones', () => {
  expect(transicionPermitida('agendada', 'atendida')).toBe(true);
  expect(transicionPermitida('cancelada', 'agendada')).toBe(false);
  expect(transicionPermitida('confirmada', 'agendada')).toBe(false);
});
test('encaja: 10:00–10:30 en bloque 09:00–14:00 de CDMX', () => { /* ... */ });
test('no encaja si termina después del bloque', () => { /* 13:45 + 30 min */ });
test('Review Focus 1: cita 23:30–00:30 local nunca encaja', () => { /* ... */ });
test('Review Focus 1: Tijuana día de cambio de horario (2026-03-08) usa el día local correcto', () => { /* ... */ });
test('huecos: bloque 09–11, 30 min, cita 09:30 → [09:00, 10:00, 10:30] en UTC', () => {
  expect(huecosLibres({ fecha: '2026-11-16', zona: 'America/Mexico_City', bloques: [{ diaSemana: 1, horaInicio: '09:00', horaFin: '11:00' }],
    ocupados: [rango('2026-11-16T15:30:00Z', 30)], duracionMin: 30, ahora: DateTime.fromISO('2026-11-01T00:00:00Z') }))
    .toEqual(['2026-11-16T15:00:00.000Z', '2026-11-16T16:00:00.000Z', '2026-11-16T16:30:00.000Z']);
});
test('huecos: nunca en el pasado; día sin bloques → []', () => { /* ... */ });
test('Review Focus 5: médico no gestiona a otro médico; recepción y admin sí', () => { /* ... */ });
test('validarSemana rechaza bloques encimados y formato inválido', () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/svc-agenda test:unit` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm --filter @consultorio/svc-agenda test` — Expected: PASS y cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(agenda): reglas de estados, horario, disponibilidad y permisos`.

---

### Task 7: `svc-agenda` · médicos, tipos de cita, horario, bloqueos y disponibilidad

**Files:**
- Create: `packages/contracts/src/api/agenda.ts`, `apps/svc-agenda/src/datos/{tipos-cita,horario,bloqueos}.ts`, `apps/svc-agenda/src/rutas/{medicos,tipos-cita,horario,bloqueos,disponibilidad}.ts`, `apps/svc-agenda/src/rutas/acceso.ts`
- Modify: `apps/svc-agenda/src/server.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/unit/api-agenda.test.ts`, `apps/svc-agenda/test/integration/{configuracion,disponibilidad}.test.ts`

**Interfaces:**
- Consumes: Tasks 5–6.
- Produces:
  - En `api/agenda.ts`: `medicoAgendaSchema { usuarioId, nombre }`, `tipoCitaSchema { id, medicoId, nombre(1..80), duracionMin(5..480), activo }`, `crearTipoCitaSchema`, `editarTipoCitaSchema { nombre?, duracionMin?, activo? }`, `bloqueHorarioSchema { diaSemana(0..6), horaInicio /^\d{2}:\d{2}$/, horaFin }`, `semanaSchema { bloques: BloqueHorario[] (máx 28) }`, `bloqueoSchema { id, medicoId, inicio, fin, motivo }`, `crearBloqueoSchema { inicio, fin, motivo?(≤200) }` con `inicio < fin`, `disponibilidadSchema { fecha, tipoCitaId, huecos: string[] }`.
  - `exigirGestion(req, medicoId)` en `rutas/acceso.ts`: `puedeGestionarMedico` → si no, 403 `PROHIBIDO`; médico inexistente o inactivo en el tenant → 404 `NO_ENCONTRADO`.
  - `GET /medicos` → `{ medicos }` activos: todos para admin y recepción; solo él mismo para un médico.
  - `GET /medicos/:id/tipos-cita` (incluye inactivos con `?todos=1`), `POST` → 201, `PATCH /medicos/:id/tipos-cita/:tipoId` → 200. Nombre duplicado entre activos → 409 `CONFLICTO`.
  - `GET /medicos/:id/horario` → `{ bloques }`; `PUT` con `semanaSchema` → borra e inserta en una transacción; violación de `EXCLUDE` → 400 `VALIDACION`.
  - `GET /medicos/:id/bloqueos?desde&hasta`, `POST` → 201, `DELETE /medicos/:id/bloqueos/:bloqueoId` → 204.
  - `GET /medicos/:id/disponibilidad?fecha&tipoCitaId` → `huecosLibres` con citas no canceladas y bloqueos del día local (consulta acotada a `[inicio del día local, fin del día local)` convertido a UTC) y `ahora = reloj()`.
  - Estas escrituras de configuración no emiten eventos (no son de interés para otros servicios en esta entrega).

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('recepción crea tipo de cita para un médico; médico ve solo los suyos', async () => { /* ... */ });
test('tipo de cita con duración 3 → 400; nombre duplicado activo → 409', async () => { /* ... */ });
test('PUT horario reemplaza la semana; bloques encimados → 400 y la semana anterior queda intacta', async () => { /* ... */ });
test('bloqueo con fin <= inicio → 400', async () => { /* ... */ });
test('disponibilidad excluye citas y bloqueos y respeta reloj inyectado', async () => { /* reloj fijo */ });
test('Review Focus 5: médico pide disponibilidad de otro médico → 403', async () => { /* ... */ });
test('médico de otro tenant → 404; médico inactivo → 404', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/contracts --filter=@consultorio/svc-agenda` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(agenda): tipos de cita, horario, bloqueos y disponibilidad`.

---

### Task 8: `svc-agenda` · citas

**Files:**
- Create: `packages/contracts/src/events/agenda.ts`, `apps/svc-agenda/src/datos/citas.ts`, `apps/svc-agenda/src/rutas/citas.ts`, `apps/svc-agenda/src/datos/errores.ts`
- Modify: `packages/contracts/src/api/agenda.ts`, `packages/contracts/src/index.ts`, `apps/svc-agenda/src/server.ts`
- Test: `apps/svc-agenda/test/unit/errores.test.ts`, `apps/svc-agenda/test/integration/{citas,citas-concurrencia}.test.ts`

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces:
  - Eventos (spec §3.5): `CitaCreada`, `CitaReprogramada`, `CitaCancelada`, `CitaEstadoCambiado`, todos v1 y sin datos de contacto.
  - `citaSchema { id, medicoId, tipoCitaId, inicio, fin, estado, contacto: { nombre(1..120), telefono(/^\+?[0-9 ()-]{8,20}$/), email? }, notas?(≤1000), fueraDeHorario, version }`; `crearCitaSchema`, `reprogramarCitaSchema { version, inicio, tipoCitaId?, medicoId?, fueraDeHorario? }`, `cambiarEstadoSchema { version, estado }`.
  - `traducirErrorPg(err): AppError | null` en `datos/errores.ts`: `23P01` sobre `cita_sin_traslape` → 409 `HORARIO_OCUPADO`; si no, `null`.
  - `POST /citas`: `exigirGestion`; tipo activo del médico (si no, 400); `rangoDeCita`; `inicio` en el pasado → 400; encima de un bloqueo → 409 `HORARIO_BLOQUEADO`; `!encajaEnHorario && !fueraDeHorario` → 422 `FUERA_DE_HORARIO`; inserta con `estado 'agendada'`, `origen 'recepcion'`, `creada_por = sub` y `CitaCreada` en una transacción → 201 `Cita`.
  - `PATCH /citas/:id` (reprogramar): `exigirGestion` sobre el médico de origen **y** el de destino; `puedeReprogramar`; `UPDATE ... WHERE id=$ AND version=$` → 0 filas con la cita existente → 409 `CONFLICTO_VERSION`; mismas validaciones que el alta; `estado = 'agendada'`, `version + 1`, `CitaReprogramada`.
  - `POST /citas/:id/estado`: `transicionPermitida` (si no, 409 `CONFLICTO`); versión igual que arriba; emite `CitaCancelada` si `a = 'cancelada'`, si no `CitaEstadoCambiado`.
  - `GET /citas?desde&hasta&medicoId`: rango ≤ 31 días (si no, 400); un médico solo obtiene las suyas (con `medicoId` de otro → 403); orden por inicio.
  - `GET /citas/:id` → `Cita`, sujeto a `exigirGestion`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('crear cita en horario → 201 y outbox con cita.creada sin datos de contacto', async () => {
  const ev = await ultimoEvento('cita.creada');
  expect(JSON.stringify(ev.data)).not.toMatch(/telefono|contacto|5555/);
});
test('fuera de horario sin bandera → 422 FUERA_DE_HORARIO; con bandera → 201 fueraDeHorario=true', async () => { /* ... */ });
test('sobre un bloqueo → 409 HORARIO_BLOQUEADO aun con fueraDeHorario', async () => { /* ... */ });
test('dos POST simultáneos al mismo hueco → uno 201, otro 409 HORARIO_OCUPADO', async () => {
  const [a, b] = await Promise.all([crear(cuerpo), crear(cuerpo)]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
});
test('una cita cancelada libera el hueco', async () => { /* ... */ });
test('Review Focus 2: dos reprogramaciones con la misma versión → una 200, otra 409 CONFLICTO_VERSION', async () => { /* ... */ });
test('reprogramar una cita atendida → 409; transición cancelada→confirmada → 409', async () => { /* ... */ });
test('reprogramar a otro médico siendo médico → 403', async () => { /* ... */ });
test('Review Focus 5: médico lista citas con medicoId de otro → 403', async () => { /* ... */ });
test('GET /citas con rango de 40 días → 400', async () => { /* ... */ });
test('cancelar emite cita.cancelada; confirmar emite cita.estado_cambiado', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/contracts --filter=@consultorio/svc-agenda` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS y cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(agenda): citas sin doble reserva, reprogramación con versión y eventos`.

---

### Task 9: Gateway, Docker y E2E de API de agenda

**Files:**
- Modify: `apps/gateway/src/{rutas.ts,config.ts}`, `docker-compose.yml`, `docker/postgres/init.sql`, `docker/postgres/init.sh`, `scripts/generar-dev-env.sh`, `.env.example`
- Create: `tests/e2e/test/agenda.e2e.test.ts`
- Test: `apps/gateway/test/unit/{rutas,config}.test.ts`, `apps/gateway/test/integration/gateway.test.ts`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces:
  - `type Servicio = 'identidad' | 'auditoria' | 'agenda'`; `SERVICIOS` incluye `agenda`; env `AGENDA_URL` obligatoria. Sin rutas abiertas nuevas.
  - `init.sql` crea `agenda_migrator`, `agenda_app` (NOBYPASSRLS) y `agenda_db`; `init.sh` pasa `AGENDA_MIGRATOR_PASSWORD` y `AGENDA_APP_PASSWORD`; `generar-dev-env.sh` y `.env.example` las agregan.
  - `docker-compose.yml`, perfil `app`: servicio `svc-agenda` (`docker/Dockerfile.service`, `APP: svc-agenda`, `PORT: 3004`, mismas variables que auditoría) y el gateway con `AGENDA_URL: http://svc-agenda:3004` y `depends_on` agenda sano.
  - E2E: un consultorio (médico admin con MFA, vía `crearConsultorio`) configura un tipo de cita y su horario, consulta la disponibilidad, crea una cita, la reprograma y la cancela por el gateway. La auditoría termina mostrando `cita.creada`, `cita.reprogramada` y `cita.cancelada`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('rutas /api/agenda/* son protegidas y se enrutan a AGENDA_URL', () => { /* clasificarRuta + urlDestino */ });
test('config sin AGENDA_URL falla al iniciar', () => { /* ... */ });
// agenda.e2e.test.ts
test('flujo de agenda de punta a punta y auditoría', async () => { /* ... vi.waitFor hasta ver cita.* */ });
test('sin token → 401 en /api/agenda/citas', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/gateway test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces. Regenerar `.env` local si hace falta (`scripts/generar-dev-env.sh` respeta el archivo existente y solo agrega las variables que faltan).
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm --filter @consultorio/gateway test && docker compose down -v && docker compose --profile app up -d --build --wait && pnpm --filter @consultorio/e2e test` — Expected: PASS (Fase 0 + agenda).
- [ ] **Step 5: Commit** `feat(gateway): enrutar agenda; compose y E2E de API de agenda`.

---

### Task 10: `apps/web` · base, cliente del gateway y sesión

**Files:**
- Create: `apps/web/{package.json,next.config.ts,tsconfig.json,vitest.config.ts,postcss.config.mjs,components.json}`, `apps/web/src/app/{layout.tsx,globals.css}`, `apps/web/src/proxy.ts`
- Create: `apps/web/src/lib/api/{gateway.ts,resultado.ts}`, `apps/web/src/lib/sesion/{cookies.ts,token.ts,desvios.ts,contexto.ts}`, `apps/web/src/lib/config.ts`
- Create: `docker/Dockerfile.web`; modify `docker-compose.yml`, `apps/gateway` (`CONFIAR_EN_PROXY` en compose)
- Test: `apps/web/test/unit/lib/{gateway,resultado,cookies,token,desvios,proxy}.test.ts`

**Interfaces:**
- Consumes: contratos de las Tasks 1, 3, 7 y 8.
- Produces:
  - `package.json` `@consultorio/web`: scripts `dev` (`next dev -p 3000`), `build` (`next build`), `start`, `typecheck`, `lint` y los tres de pruebas. `next.config.ts`: `output: 'standalone'`, `outputFileTracingRoot` = raíz del monorepo, `transpilePackages: ['@consultorio/contracts']`.
  - `config.ts`: `GATEWAY_URL` (servidor, obligatoria), `COOKIE_SEGURA` (`'true'` en producción).
  - `Resultado<T> = { ok: true; datos: T } | { ok: false; status: number; error: ApiError }`.
  - `llamarGateway<T>(ruta: string, o: { metodo?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; cuerpo?: unknown; esquema?: z.ZodType<T>; auth: 'token' | 'sesion' | 'ninguna'; ip?: string }): Promise<Resultado<T>>` (`import 'server-only'`). Usa `GATEWAY_URL`, agrega `Authorization: Bearer` (token) o `Cookie` (sesión, solo rutas `/api/identidad/`), `X-Forwarded-For` con la IP del cliente, valida la respuesta con `esquema` (si no cuadra → `{ ok: false, status: 502, error: { code: 'INTERNO' } }`) y devuelve error de red como `status: 503`. También entrega los `set-cookie` cuando `auth` es `sesion` o `ninguna` (`Resultado` incluye `setCookies?: string[]`).
  - `cookies.ts`: `guardarCookiesAuth(setCookies: string[])` replica cada cookie de Better Auth (nombres que contienen `better-auth.`) como cookie httpOnly de Next con el mismo nombre, valor y `maxAge`, `sameSite: 'lax'` y `secure: COOKIE_SEGURA`; `cabeceraCookieAuth(): string`; `guardarToken(token)`, `leerToken()`, `guardarConsultorio(id)`, `leerConsultorio()` (cookies `token_consultorio` y `consultorio_id`); `cerrarSesion()` borra todas.
  - `token.ts`: `necesitaRenovar(token: string | undefined, ahora: Date): boolean` (sin token o le quedan < 60 s; decodifica `exp` sin verificar, solo para decidir); `claimsDelToken(token): TokenClaims` (decodifica con `tokenClaimsSchema`; la autorización real la hacen gateway y servicios).
  - `desvios.ts`: `destinoPorError(e: ApiError, status: number): '/login' | '/cambiar-password' | '/configurar-mfa' | '/sin-acceso' | null`.
  - `proxy.ts` (Next ≥ 16; `middleware.ts` si la versión instalada no soporta `proxy`): rutas públicas `/login`, `/login/mfa`, `/registro`. En el resto, sin cookie de Better Auth → `/login`. Si hay sesión y `consultorio_id` y `necesitaRenovar(token)` → `POST /api/identidad/sesion/tenant` y escribe el `token_consultorio` nuevo en la respuesta. Errores → `destinoPorError`. Sin `consultorio_id` → `/elegir-consultorio`. Las rutas del flujo de entrada (`/cambiar-password`, `/configurar-mfa`, `/elegir-consultorio`) solo exigen sesión.
  - `contexto.ts`: `obtenerContexto(): Promise<{ claims: TokenClaims; consultorio: Consultorio }>` para Server Components (lee la cookie y llama a `GET /api/identidad/consultorio`, cacheado por petición con `cache()` de React).
  - `Dockerfile.web`: multi-stage con `turbo prune @consultorio/web --docker`, `next build`, runtime `node:24-slim` sin root que copia `.next/standalone`, `.next/static` y `public`, `HEALTHCHECK` a `/login`. Compose: servicio `web` (perfil `app`, puerto 3000, `GATEWAY_URL: http://gateway:8080`, `depends_on` gateway sano). El gateway confía en la red de compose (`CONFIAR_EN_PROXY` con el CIDR de la red de compose, fijado en `docker-compose.yml` vía `networks.default.ipam`).
  - Base de UI: Tailwind 4 y `components.json` de shadcn con los componentes `button`, `input`, `label`, `form`, `dialog`, `select`, `table`, `toast` (sonner), `card`, `badge`, `tabs`, `dropdown-menu`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('llamarGateway agrega Bearer con auth token y valida con esquema', async () => { /* fetch simulado */ });
test('respuesta que no cumple el esquema → ok:false 502 INTERNO', async () => { /* ... */ });
test('error de red → ok:false 503', async () => { /* ... */ });
test('cookie de sesión solo se envía a /api/identidad/', async () => { /* ... */ });
test('necesitaRenovar: sin token, con 30 s restantes → true; con 10 min → false', () => { /* ... */ });
test.each([['PASSWORD_TEMPORAL', 403, '/cambiar-password'], ['MFA_REQUERIDA', 403, '/configurar-mfa'], ['NO_AUTENTICADO', 401, '/login'], ['PROHIBIDO', 403, '/sin-acceso']])(
  'destinoPorError(%s)', (code, status, destino) => expect(destinoPorError({ code, message: '' }, status)).toBe(destino));
test('Review Focus 4: proxy renueva un token por vencer y lo escribe en la respuesta', async () => { /* NextRequest simulado */ });
test('Review Focus 4: proxy con sesión vencida (401) redirige a /login y borra cookies', async () => { /* ... */ });
test('guardarCookiesAuth replica solo cookies de Better Auth, httpOnly y sameSite lax', () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm install && pnpm --filter @consultorio/web test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm --filter @consultorio/web typecheck lint test build` — Expected: PASS, cobertura ≥ 80% y build standalone.
- [ ] **Step 5: Imagen y compose.** Run: `docker compose --profile app up -d --build --wait && curl -s -o /dev/null -w '%{http_code}' localhost:3000/login` — Expected: `200`.
- [ ] **Step 6: Commit** `feat(web): base Next.js, cliente del gateway y manejo de sesión`.

---

### Task 11: `apps/web` · flujo de entrada

**Files:**
- Create: `apps/web/src/features/sesion/{actions.ts,api.ts,logica/validaciones.ts,components/*}`, `apps/web/src/app/(entrada)/{login,login/mfa,registro,cambiar-password,configurar-mfa,elegir-consultorio}/page.tsx`, `apps/web/src/app/sin-acceso/page.tsx`
- Test: `apps/web/test/unit/features/sesion/{validaciones,actions,components}.test.ts(x)`

**Interfaces:**
- Consumes: Task 10.
- Produces (server actions; cada una devuelve `EstadoFormulario = { ok?: true; errores?: Record<string, string>; mensaje?: string }` para `useActionState`):
  - `registrarConsultorio(prev, formData)` → `POST /api/identidad/registro` (con `esMedico`) y luego inicia sesión → `/configurar-mfa`.
  - `iniciarSesion(prev, formData)` → `POST /api/identidad/auth/sign-in/email`; si la respuesta trae `twoFactorRedirect` → guarda cookies → `/login/mfa`; si no → `continuarAConsultorio()`.
  - `verificarTotp(prev, formData)` → `POST /api/identidad/auth/two-factor/verify-totp` → `continuarAConsultorio()`.
  - `continuarAConsultorio()`: `GET /api/identidad/tenants/mios`; si hay uno → `guardarConsultorio` + pedir token → `/agenda`; si hay varios → `/elegir-consultorio`; si el token responde con error → `destinoPorError`.
  - `elegirConsultorio(prev, formData)`, `cambiarPassword(prev, formData)` (`/auth/change-password`, `revokeOtherSessions: true`) → `continuarAConsultorio()`.
  - `iniciarConfiguracionMfa(prev, formData)` (`/auth/two-factor/enable` con contraseña → `totpURI` + códigos de respaldo; el QR se genera en el servidor como SVG con `qrcode`) y `confirmarMfa(prev, formData)` (`verify-totp`) → `continuarAConsultorio()`.
  - `cerrarSesion()` → `/auth/sign-out` + `cerrarSesion()` de cookies → `/login`.
  - `logica/validaciones.ts`: esquemas de formulario (reusan las reglas de `packages/contracts` y de la Task 1: slug, zona IANA, password ≥ 10, TOTP de 6 dígitos) y `erroresDeZod(err): Record<string, string>` con mensajes en español.
  - Zona horaria en el registro: `<select>` con `Intl.supportedValuesOf('timeZone')` filtrado a `America/*`, con `America/Mexico_City` por omisión.

- [ ] **Step 1: Escribir las pruebas que fallan**

```tsx
test('validaciones: slug con mayúsculas y TOTP de 5 dígitos dan mensajes en español', () => { /* ... */ });
test('iniciarSesion con twoFactorRedirect → redirige a /login/mfa', async () => { /* llamarGateway simulado; redirect de next/navigation simulado */ });
test('continuarAConsultorio con un consultorio → guarda token y va a /agenda', async () => { /* ... */ });
test('continuarAConsultorio con PASSWORD_TEMPORAL → /cambiar-password', async () => { /* ... */ });
test('credenciales inválidas → mensaje "Correo o contraseña incorrectos" sin revelar cuál', async () => { /* ... */ });
test('FormularioLogin muestra errores por campo y deshabilita el botón al enviar', async () => { /* Testing Library */ });
test('ConfigurarMfa muestra el QR y los códigos de respaldo', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/web test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces. Las páginas solo componen los componentes de `features/sesion`.
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm --filter @consultorio/web typecheck lint test build` — Expected: PASS y cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(web): registro, login con MFA, cambio de contraseña y elección de consultorio`.

---

### Task 12: `apps/web` · agenda

**Files:**
- Create: `apps/web/src/features/agenda/{actions.ts,api.ts,logica/{eventos-calendario,formato,errores}.ts,components/{Calendario,FormularioCita,DetalleCita,ListaDelDia,FiltroMedico}.tsx}`, `apps/web/src/app/(app)/layout.tsx` (navegación según rol y admin), `apps/web/src/app/(app)/agenda/page.tsx`
- Test: `apps/web/test/unit/features/agenda/**`

**Interfaces:**
- Consumes: Tasks 8, 10 y 11 (`obtenerContexto`, `llamarGateway`, `citaSchema`, `disponibilidadSchema`).
- Produces:
  - `api.ts`: `listarMedicos()`, `listarCitas(desde, hasta, medicoId?)`, `listarTiposCita(medicoId)`, `obtenerDisponibilidad(medicoId, fecha, tipoCitaId)`.
  - `actions.ts`: `crearCita`, `reprogramarCita`, `cambiarEstadoCita`, todas con `revalidatePath('/agenda')` y devolviendo `EstadoFormulario` o `{ ok: false; motivo: 'FUERA_DE_HORARIO' }` para ofrecer "Agendar de todos modos".
  - `logica/eventos-calendario.ts`: `citasAEventos(citas: Cita[], medicos: MedicoAgenda[], zona: string): EventInput[]` (título = nombre de contacto + tipo, color por estado, `editable` solo si `agendada` o `confirmada`).
  - `logica/errores.ts`: `mensajeDeError(code): string` con los textos exactos de la spec §4.5 ("Ese horario ya se ocupó, elige otro", "El médico tiene ese horario bloqueado", "Alguien modificó esta cita"…).
  - `logica/formato.ts`: `formatearRango(inicio, fin, zona): string` en `es-MX`.
  - `Calendario` envuelve FullCalendar (`timeGridDay`, `timeGridWeek`, `locale: 'es'`, `timeZone` del consultorio, `eventDrop` → `reprogramarCita` y revierte con `info.revert()` si falla). Por debajo de 768 px se muestra `ListaDelDia`. Admin y recepción ven `FiltroMedico`; un médico ve solo su agenda.
  - `FormularioCita`: médico → tipo → fecha → huecos (de `obtenerDisponibilidad`) → contacto → notas. Ante `HORARIO_OCUPADO` recarga los huecos.
  - Layout `(app)`: menú con Agenda, Médicos (admin y recepción; un médico va a su propia página), Equipo y Bitácora (solo admin), Perfil y Cerrar sesión.

- [ ] **Step 1: Escribir las pruebas que fallan**

```tsx
test('citasAEventos: cancelada no editable y con color de cancelada; hora en zona del consultorio', () => { /* ... */ });
test('mensajeDeError usa los textos de la spec', () => { expect(mensajeDeError('HORARIO_OCUPADO')).toBe('Ese horario ya se ocupó, elige otro'); });
test('crearCita con FUERA_DE_HORARIO devuelve motivo para confirmar', async () => { /* ... */ });
test('Review Focus 2: reprogramar con CONFLICTO_VERSION devuelve "Alguien modificó esta cita"', async () => { /* ... */ });
test('FormularioCita: al elegir tipo y fecha muestra huecos; HORARIO_OCUPADO recarga huecos', async () => { /* ... */ });
test('DetalleCita solo ofrece transiciones permitidas', async () => { /* agendada → confirmar, atender, no asistió, cancelar */ });
test('ListaDelDia ordena por hora y muestra estado', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/web test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces. Agregar las dependencias de FullCalendar y Luxon.
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm --filter @consultorio/web typecheck lint test build` — Expected: PASS y cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(web): agenda con calendario, alta, reprogramación y estados de cita`.

---

### Task 13: `apps/web` · médicos, equipo, perfil y bitácora

**Files:**
- Create: `apps/web/src/features/{medicos,equipo,perfil,bitacora}/{actions.ts,api.ts,logica/*,components/*}`, `apps/web/src/app/(app)/{medicos,medicos/[id],equipo,perfil,bitacora}/page.tsx`
- Test: `apps/web/test/unit/features/{medicos,equipo,perfil,bitacora}/**`

**Interfaces:**
- Consumes: Tasks 2–4, 7, 10 y 11.
- Produces:
  - **Médicos** (`/medicos` lista para admin y recepción; `/medicos/[id]` con pestañas Horario, Tipos de cita y Bloqueos): `guardarSemana`, `crearTipoCita`, `editarTipoCita`, `crearBloqueo`, `eliminarBloqueo`. `logica/semana.ts`: `semanaDesdeFormulario(formData): BloqueHorario[]` y validación previa con las mismas reglas de `validarSemana` (copiadas como lógica de formulario; la autoridad es el servicio).
  - **Equipo** (`/equipo`, solo admin): `altaMiembro` (nombre, email, rol, admin, contraseña temporal; muestra la contraseña una sola vez para que el admin la comparta), `editarMiembro` (rol y admin), `reiniciarPassword`, `quitarMiembro` (con diálogo de confirmación). El 409 de "último admin" se muestra como "El consultorio necesita al menos un administrador".
  - **Perfil** (`/perfil`): perfil médico si `rol = 'medico'` (`PUT /api/identidad/medicos/:id/perfil`) y cambio de contraseña (reusa `cambiarPassword` de la Task 11).
  - **Bitácora** (`/bitacora`, solo admin): tabla con fecha (zona del consultorio), quién (nombre resuelto con `GET /miembros`, o "Sistema" si no hay actor), acción (etiqueta legible desde `logica/acciones.ts`: `etiquetaAccion('cita.creada') = 'Cita creada'` y equivalentes para todas las acciones conocidas; si no la conoce, el código tal cual) y filtros desde, hasta y acción. Paginación "Ver más" con `siguiente`.
  - Las páginas solo de admin responden con `/sin-acceso` si `!claims.admin` (además del 403 del servicio).

- [ ] **Step 1: Escribir las pruebas que fallan**

```tsx
test('semanaDesdeFormulario arma bloques y detecta encimados antes de enviar', () => { /* ... */ });
test('altaMiembro muestra la contraseña temporal una sola vez', async () => { /* ... */ });
test('quitar al último admin muestra "El consultorio necesita al menos un administrador"', async () => { /* ... */ });
test('etiquetaAccion cubre todas las acciones conocidas y deja las desconocidas', () => { /* ... */ });
test('TablaBitacora resuelve nombres y muestra "Sistema" sin actor', async () => { /* ... */ });
test('página de equipo sin admin → redirect /sin-acceso', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/web test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm --filter @consultorio/web typecheck lint test build` — Expected: PASS y cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(web): médicos, equipo, perfil y bitácora`.

---

### Task 14: E2E de navegador, CI, infraestructura (solo código) y documentación

**Files:**
- Create: `tests/e2e-web/{package.json,playwright.config.ts,tsconfig.json}`, `tests/e2e-web/test/{entrada,agenda,permisos}.spec.ts`, `tests/e2e-web/test/apoyo.ts`
- Modify: `.github/workflows/ci.yml`, `infra/lib/{datos,servicios}.ts`, `infra/test/infra.test.ts`, `README.md`, `pnpm-workspace.yaml` (si hace falta)
- Test: los propios specs de Playwright y `infra/test/infra.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - `@consultorio/e2e-web`, script `test` = `playwright test`, `baseURL` `http://localhost:3000`, solo Chromium, `retries: 1`, trazas al fallar. `apoyo.ts`: `registrarYEntrar(page)` (registro → configurar MFA leyendo el secreto del `totpURI` mostrado y generando el código con `otplib`) y `codigoTotp(secreto)`.
  - `entrada.spec.ts`: registro → MFA → agenda vacía. Un admin da de alta a una recepcionista con contraseña temporal → ella entra → se le obliga a cambiarla → llega a la agenda.
  - `agenda.spec.ts`: configurar horario y tipo → crear cita desde un hueco sugerido → reprogramar arrastrando → cancelar → la bitácora muestra las tres acciones.
  - `permisos.spec.ts`: la recepción no ve "Equipo" ni entra a `/equipo` (llega a `/sin-acceso`). Un segundo médico no ve las citas del primero.
  - CI: el job `e2e` levanta `docker compose --profile app`, corre `tests/e2e` y luego `tests/e2e-web` (`npx playwright install --with-deps chromium`). Sube el reporte de Playwright como artefacto si falla.
  - Infra (solo código, $0): `datos.ts` documenta `agenda_db` en la misma instancia RDS (las bases se crean en el arranque de la tarea de migración, como las existentes); `servicios.ts` agrega `svc-agenda` (Fargate, puerto 3004) y `web` (Fargate, puerto 3000, detrás del ALB en `/`; el gateway queda en `/api/*`), con sus repos ECR `IMMUTABLE`. Pruebas de CDK: existen los servicios, el ALB enruta `/` a web y `/api/*` al gateway, y la estimación de costo en `bin/app.ts` se actualiza.
  - README: cómo levantar el sitio (`http://localhost:3000`), cómo correr Playwright y las variables nuevas.

- [ ] **Step 1: Escribir los specs y las pruebas de infra que fallan.** (Los nombres de prueba y los flujos son los de Interfaces.)
- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/infra test` — Expected: FAIL en las nuevas.
- [ ] **Step 3: Implementar** infra, CI y README. Prohibido ejecutar `cdk deploy`, `cdk bootstrap` o `aws`; solo `cdk synth` dentro de las pruebas.
- [ ] **Step 4: Verificación completa.** Run: `pnpm turbo run typecheck lint test --filter='!@consultorio/e2e' --filter='!@consultorio/e2e-web' && docker compose down -v && docker compose --profile app up -d --build --wait && pnpm --filter @consultorio/e2e test && pnpm --filter @consultorio/e2e-web test` — Expected: todo PASS.
- [ ] **Step 5: Commit** `test(e2e): flujos de navegador; ci, infra (solo código) y docs de la entrega 1`.

---

## Criterio de terminado de la entrega 1

- Los 5 criterios de éxito de la spec §1 se cumplen y se ven en `http://localhost:3000`.
- `pnpm turbo run typecheck lint test` en verde, con cobertura ≥ 80% en cada paquete (incluido `apps/web` según su alcance).
- E2E de API (Fase 0 + agenda) y E2E de navegador en verde contra `docker compose --profile app`.
- Revisión de cada tarea y revisión final de la rama sin hallazgos importantes abiertos.
- Costo de nube: $0 (nada desplegado).
