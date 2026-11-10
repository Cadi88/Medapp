# Fase 0 · Plataforma — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar lista la base técnica del SaaS: monorepo, contratos, librería de plataforma (tenant/RLS, outbox/inbox, auth, observabilidad), gateway, servicio de identidad (registro de consultorio, usuarios, roles, MFA), servicio de auditoría, entorno local, CI/CD e infraestructura base.

**Architecture:** Monorepo pnpm + Turborepo con microservicios Fastify en TypeScript. Cada servicio tiene su propia base PostgreSQL con `tenant_id` + Row-Level Security, publica eventos vía tabla outbox → NATS JetStream y consume con inbox idempotente. El gateway verifica JWT emitidos por `svc-identidad` y enruta; los servicios vuelven a verificar el JWT.

**Tech Stack:** Node.js 24 LTS, TypeScript (strict, ESM), pnpm, Turborepo, Fastify 5, Zod, `pg`, Drizzle ORM (consultas), SQL plano (migraciones), NATS JetStream (`@nats-io/jetstream`), Better Auth (+ plugin `twoFactor`), `jose`, pino, OpenTelemetry, pg-boss, Vitest, Testcontainers, Docker Compose, GitHub Actions, AWS CDK.

**Spec:** `docs/superpowers/specs/2026-11-10-saas-consultorios-design.md`

## Global Constraints

- Node.js 24 LTS; TypeScript `strict: true`; módulos ESM.
- PostgreSQL 16; todas las fechas `timestamptz` en UTC; zona horaria del tenant como nombre IANA.
- Identificadores UUIDv7.
- Toda tabla de negocio: `tenant_id uuid NOT NULL` + RLS `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)` con el mismo `WITH CHECK`, y `ALTER TABLE ... FORCE ROW LEVEL SECURITY`. (El `NULLIF` es obligatorio: tras un `set_config(..., true)` la conexión del pool conserva el parámetro como `''`, y `''::uuid` lanzaría error en vez de devolver cero filas.)
- Cada servicio usa dos roles: `<svc>_migrator` (dueño de tablas, corre migraciones) y `<svc>_app` (sin `BYPASSRLS`, no dueño). El código de negocio usa solo `<svc>_app`.
- `apps/*` pueden depender de `packages/*`, nunca de otro `apps/*`.
- Formato de error único: `{ code, message, details? }`.
- Roles: `admin`, `medico`, `recepcion`. MFA obligatorio para `medico` y `admin`.
- Eventos: sobre definido en la spec §4 (`event_id`, `type`, `version`, `tenant_id`, `actor_id`, `occurred_at`, `trace_id`, `data`); subject NATS `evt.<type>`.
- Consumidores: máximo 5 entregas; después, a dead-letter (`dlq.<type>`).
- Logs estructurados con `tenant_id`, `trace_id`, `servicio`.
- Región AWS `mx-central-1`; RDS y S3 cifrados con KMS; PITR con retención de 35 días.
- Ningún servicio se despliega si falla su prueba de aislamiento entre tenants.

## Review Focus

1. **Miembro removido con token aún vigente o que pide uno nuevo** → no debe obtener token nuevo (403) y su token anterior expira en ≤15 min. Prueba en Task 7.
2. **Eventos de auditoría concurrentes del mismo tenant** → secuencia sin huecos ni duplicados y cadena válida. Prueba en Task 8.
3. **Registro con slug o email ya existente** → 409 `CONFLICTO` y ningún tenant/usuario a medio crear. Prueba en Task 6.
4. **NATS caído mientras un servicio escribe** → la escritura tiene éxito y el evento se publica al volver NATS. Prueba en Task 4.
5. **JWT firmado con otra llave, expirado o sin `tid`** → 401 `NO_AUTENTICADO` en gateway y en servicio. Prueba en Task 5 y Task 9.

---

## Mapa de archivos

```
package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json,
vitest.workspace.ts, eslint.config.js, .nvmrc, .env.example
docker-compose.yml
docker/postgres/init.sql            Bases y roles por servicio
docker/Dockerfile.service           Imagen multi-stage genérica (turbo prune)
.github/workflows/ci.yml

packages/contracts/src/
  index.ts
  envelope.ts        sobre de evento + defineEvent
  events/identidad.ts
  errors.ts          apiErrorSchema, ErrorCode
  auth.ts            Rol, tokenClaimsSchema
packages/platform/src/
  index.ts
  ids.ts             uuidv7
  canonical.ts       canonicalJson, sha256Hex
  db/pool.ts         createPool
  db/tenant.ts       withTenant
  db/migrate.ts      runMigrations
  db/rls.ts          rlsPolicySql
  events/sql.ts      OUTBOX_INBOX_SQL
  events/outbox.ts   enqueueEvent, startOutboxPublisher
  events/streams.ts  ensureStreams
  events/consumer.ts consumeEvents
  http/errors.ts     AppError
  http/plugin.ts     platformPlugin, requireRole
  observability.ts   createLogger, initTelemetry
  testing/           startPostgres, startNats, startTestJwks
apps/svc-identidad/
  migrations/001_better_auth.sql, 002_identidad.sql
  src/{server.ts, auth.ts, tokens.ts, db/schema.ts,
       routes/registro.ts, routes/sesion.ts, routes/miembros.ts,
       routes/perfil.ts, routes/datos-fiscales.ts}
  test/
apps/svc-auditoria/
  migrations/001_auditoria.sql
  src/{server.ts, cadena.ts, consumidor.ts, verificacion.ts, routes/eventos.ts}
  test/
apps/gateway/src/{server.ts, rutas.ts}, test/
tests/e2e/fase0.e2e.test.ts
infra/{bin/app.ts, lib/red.ts, lib/datos.ts, lib/mensajeria.ts, lib/servicios.ts}, test/
```

Fuera de esta fase: `apps/web`, cliente REST interno con circuit breaker (lo necesita primero la Fase 1), agenda, expediente, facturación, notificaciones.

---

### Task 1: Monorepo y entorno local

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `eslint.config.js`, `.nvmrc`, `.env.example`, `.gitignore`
- Create: `docker-compose.yml`, `docker/postgres/init.sql`
- Test: `scripts/verificar-entorno.sh`

**Interfaces:**
- Produces: scripts raíz `pnpm build | test | lint | typecheck` (vía turbo); servicios locales: Postgres `localhost:5432`, NATS `localhost:4222` (JetStream activo, monitor `8222`), MinIO `localhost:9000`.
- Produces: bases `identidad_db`, `auditoria_db` con roles `identidad_migrator`/`identidad_app` y `auditoria_migrator`/`auditoria_app` (contraseñas en `.env.example`).

- [ ] **Step 1: Escribir el script de verificación** `scripts/verificar-entorno.sh` que falla si: `docker compose ps` no muestra `postgres`, `nats`, `minio` healthy; `psql` como `identidad_app` no conecta a `identidad_db`; `SELECT rolbypassrls FROM pg_roles WHERE rolname='identidad_app'` no devuelve `f`; `curl -s localhost:8222/jsz` no contiene `"config"` (JetStream activo).
- [ ] **Step 2: Ejecutarlo y ver que falla.** Run: `bash scripts/verificar-entorno.sh` — Expected: FAIL (no hay compose).
- [ ] **Step 3: Crear el monorepo** (workspaces `apps/*`, `packages/*`, `infra`, `tests/*`; turbo con tareas `build`, `test`, `lint`, `typecheck`) y la regla ESLint `import/no-restricted-paths` que prohíbe importar `apps/*` desde otro `apps/*`.
- [ ] **Step 4: Crear `docker-compose.yml`** (postgres:16, `nats:2 -js -m 8222`, minio) con healthchecks, y `docker/postgres/init.sql` que por cada servicio (`identidad`, `auditoria`) crea `<svc>_db`, `<svc>_migrator` (OWNER de la base) y `<svc>_app` (`NOBYPASSRLS`, `CONNECT` y `USAGE` en `public`, más `ALTER DEFAULT PRIVILEGES FOR ROLE <svc>_migrator ... GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <svc>_app`).
- [ ] **Step 5: Verificar.** Run: `docker compose up -d --wait && bash scripts/verificar-entorno.sh && pnpm lint` — Expected: PASS.
- [ ] **Step 6: Commit** `chore: monorepo y entorno local`.

---

### Task 2: `packages/contracts`

**Files:**
- Create: `packages/contracts/src/{index.ts, envelope.ts, errors.ts, auth.ts, events/identidad.ts}`
- Test: `packages/contracts/test/envelope.test.ts`, `packages/contracts/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `eventEnvelopeSchema` y `type EventEnvelope<T = unknown> = { event_id: string; type: string; version: number; tenant_id: string; actor_id: string | null; occurred_at: string; trace_id: string; data: T }`
  - `defineEvent<T>(type: string, version: number, data: z.ZodType<T>): EventDefinition<T>` con `create(i: { tenantId: string; actorId: string | null; traceId: string; data: T }): EventEnvelope<T>` (genera `event_id` UUIDv7 y `occurred_at` ISO UTC) y `parse(raw: unknown): EventEnvelope<T>` (valida sobre, `type`, `version` y `data`).
  - Eventos: `TenantCreado` (`tenant.creado` v1, data `{ tenantId, nombre, slug, zonaHoraria, adminUsuarioId }`), `UsuarioVinculado` (`usuario.vinculado` v1, `{ usuarioId, rol }`), `UsuarioDesvinculado` (`usuario.desvinculado` v1, `{ usuarioId }`), `MedicoActualizado` (`medico.actualizado` v1, `{ usuarioId, cedulaProfesional, especialidad }`).
  - `type ErrorCode = 'NO_AUTENTICADO' | 'PROHIBIDO' | 'MFA_REQUERIDA' | 'VALIDACION' | 'CONFLICTO' | 'NO_ENCONTRADO' | 'INTERNO'`; `apiErrorSchema = z.object({ code, message: z.string(), details: z.unknown().optional() })`.
  - `rolSchema = z.enum(['admin','medico','recepcion'])` y `type Rol = z.infer<typeof rolSchema>`; `tokenClaimsSchema = z.object({ sub: z.string().uuid(), tid: z.string().uuid(), rol: rolSchema, mfa: z.boolean() })` y `type TokenClaims = z.infer<typeof tokenClaimsSchema>`.
- Note: `contracts` depende solo de `zod` y `uuidv7`; no de `platform`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('create produce un sobre válido con UUIDv7 y fecha UTC', () => {
  const e = TenantCreado.create({ tenantId: T, actorId: U, traceId: 'abc',
    data: { tenantId: T, nombre: 'Consultorio Uno', slug: 'uno', zonaHoraria: 'America/Mexico_City', adminUsuarioId: U } });
  expect(e.type).toBe('tenant.creado');
  expect(e.version).toBe(1);
  expect(e.event_id[14]).toBe('7');            // UUID versión 7
  expect(e.occurred_at.endsWith('Z')).toBe(true);
});
test('parse rechaza otro type o versión', () => {
  const e = TenantCreado.create({...});
  expect(() => UsuarioVinculado.parse(e)).toThrow();
  expect(() => TenantCreado.parse({ ...e, version: 2 })).toThrow();
});
test('parse rechaza data inválida', () => {
  expect(() => TenantCreado.parse({ ...e, data: { ...e.data, slug: 1 } })).toThrow();
});
test('tokenClaimsSchema exige tid y rol válido', () => {
  expect(tokenClaimsSchema.safeParse({ sub: U, rol: 'admin', mfa: true }).success).toBe(false);
  expect(tokenClaimsSchema.safeParse({ sub: U, tid: T, rol: 'root', mfa: true }).success).toBe(false);
});
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/contracts test` — Expected: FAIL (módulos no existen).
- [ ] **Step 3: Implementar** los archivos listados con las firmas de Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): sobre de eventos, errores y claims`.

---

### Task 3: `packages/platform` · base de datos y tenant

**Files:**
- Create: `packages/platform/src/{ids.ts, canonical.ts, db/pool.ts, db/tenant.ts, db/migrate.ts, db/rls.ts, testing/postgres.ts}`
- Test: `packages/platform/test/canonical.test.ts`, `packages/platform/test/tenant.test.ts`, `packages/platform/test/migrate.test.ts`

**Interfaces:**
- Produces:
  - `uuidv7(): string`
  - `canonicalJson(v: unknown): string` — claves ordenadas recursivamente, sin espacios, `undefined` omitido; `sha256Hex(s: string): string`.
  - `createPool(url: string): pg.Pool`
  - `withTenant<T>(pool: pg.Pool, tenantId: string, fn: (tx: pg.PoolClient) => Promise<T>): Promise<T>` — `BEGIN`; `SELECT set_config('app.tenant_id', $1, true)`; `fn`; `COMMIT` (o `ROLLBACK` y relanza). Lanza `Error('tenantId inválido')` si no es UUID.
  - `runMigrations(url: string, dir: string): Promise<string[]>` — aplica `*.sql` en orden léxico, cada uno en su transacción, registrados en `schema_migrations(nombre text primary key, aplicado_en timestamptz)`; devuelve los aplicados en esta corrida; idempotente.
  - `rlsPolicySql(tabla: string): string` — `ENABLE` + `FORCE ROW LEVEL SECURITY` + política `tenant_isolation` con `USING` y `WITH CHECK` de Global Constraints.
  - `startPostgres(): Promise<{ migratorUrl: string; appUrl: string; stop(): Promise<void> }>` (Testcontainers `postgres:16`, crea rol `test_migrator` y `test_app` como en Task 1).

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('canonicalJson ordena claves y es estable', () => {
  expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } }))
    .toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
});
// tenant.test.ts — tabla de prueba "nota(tenant_id uuid not null, texto text)" creada con rlsPolicySql vía runMigrations
test('un tenant no ve filas de otro', async () => {
  await withTenant(app, A, tx => tx.query("insert into nota values ($1,'a')", [A]));
  await withTenant(app, B, tx => tx.query("insert into nota values ($1,'b')", [B]));
  const r = await withTenant(app, A, tx => tx.query('select texto from nota'));
  expect(r.rows).toEqual([{ texto: 'a' }]);
});
test('sin contexto de tenant no se ve nada (ni error) aunque la conexión ya se usó con un tenant', async () => {
  const c = await app.connect();
  await c.query('begin'); await c.query("select set_config('app.tenant_id', $1, true)", [A]); await c.query('commit');
  expect((await c.query('select * from nota')).rowCount).toBe(0);
  c.release();
});
test('no se puede insertar con tenant_id ajeno', async () => {
  await expect(withTenant(app, A, tx => tx.query("insert into nota values ($1,'x')", [B]))).rejects.toThrow(/row-level security/);
});
test('el contexto no se filtra a la siguiente transacción del mismo pool', async () => {
  await withTenant(app, A, async () => {});
  expect((await app.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? '').toBe('');
});
test('runMigrations es idempotente', async () => {
  expect(await runMigrations(migratorUrl, dir)).toHaveLength(1);
  expect(await runMigrations(migratorUrl, dir)).toHaveLength(0);
});
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/platform test` — Expected: FAIL.
- [ ] **Step 3: Implementar** las funciones de Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): pool, withTenant, migraciones y RLS`.

---

### Task 4: `packages/platform` · outbox, inbox y NATS

**Files:**
- Create: `packages/platform/src/events/{sql.ts, outbox.ts, streams.ts, consumer.ts}`, `packages/platform/src/testing/nats.ts`
- Test: `packages/platform/test/outbox.test.ts`, `packages/platform/test/consumer.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `runMigrations`, `startPostgres` (Task 3); `EventEnvelope` (Task 2).
- Produces:
  - `OUTBOX_INBOX_SQL: string` — `outbox(event_id uuid pk, tenant_id uuid, type text, payload jsonb, creado_en timestamptz default now(), publicado_en timestamptz null)` con índice parcial `WHERE publicado_en IS NULL`; `inbox(event_id uuid pk, consumidor text, procesado_en timestamptz default now())`. **Sin RLS** (infraestructura, no datos de negocio); `<svc>_app` con `SELECT, INSERT, UPDATE`.
  - `enqueueEvent(tx: pg.PoolClient, e: EventEnvelope): Promise<void>` — inserta en `outbox` dentro de la transacción del llamador.
  - `ensureStreams(nc: NatsConnection): Promise<void>` — stream `EVENTOS` (`evt.>`, retención por límites, 30 días) y `DLQ` (`dlq.>`).
  - `startOutboxPublisher(o: { pool: pg.Pool; nc: NatsConnection; intervalMs?: number /*500*/; lote?: number /*100*/ }): { stop(): Promise<void> }` — `SELECT ... WHERE publicado_en IS NULL ORDER BY creado_en LIMIT $lote FOR UPDATE SKIP LOCKED`, publica a `evt.<type>` con header `Nats-Msg-Id = event_id` (dedupe de JetStream), marca `publicado_en`. Si NATS falla, deja las filas sin marcar y reintenta en el siguiente ciclo.
  - `consumeEvents(o: { pool: pg.Pool; nc: NatsConnection; consumidor: string; subjects: string[]; handler: (e: EventEnvelope, tx: pg.PoolClient) => Promise<void>; maxEntregas?: number /*5*/ }): Promise<{ stop(): Promise<void> }>` — consumidor durable; por mensaje: `withTenant(e.tenant_id)` → `INSERT INTO inbox ... ON CONFLICT DO NOTHING`; si ya existía, `ack` sin llamar al handler; si no, `handler` y `ack` tras `COMMIT`. En error `nak` con backoff; en la entrega número `maxEntregas` que falla, publica el mensaje original a `dlq.<type>` y hace `term`.
  - `startNats(): Promise<{ url: string; stop(): Promise<void>; pause(): Promise<void>; unpause(): Promise<void> }>`.
  - Trazas: el publicador agrega header `traceparent` derivado de `trace_id`; el consumidor abre un span hijo y crea un logger con `tenant_id` y `trace_id` del evento, que pasa al handler como tercer argumento `ctx: { logger: pino.Logger }`. Firma final del handler: `(e: EventEnvelope, tx: pg.PoolClient, ctx: { logger: pino.Logger }) => Promise<void>`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('el evento solo existe si la transacción hace commit', async () => {
  await expect(withTenant(app, A, async tx => { await enqueueEvent(tx, evento()); throw new Error('x'); })).rejects.toThrow();
  expect((await migrator.query('select count(*)::int c from outbox')).rows[0].c).toBe(0);
});
test('el publicador entrega a evt.<type> y marca publicado_en', async () => {
  await withTenant(app, A, tx => enqueueEvent(tx, evento('tenant.creado')));
  const recibido = await siguienteMensaje(nc, 'evt.tenant.creado');
  expect(recibido.tenant_id).toBe(A);
  await vi.waitFor(async () => expect(await pendientes()).toBe(0));
});
test('Review Focus 4: con NATS caído la escritura funciona y el evento sale al volver', async () => {
  await nats.pause();
  await withTenant(app, A, tx => enqueueEvent(tx, evento()));
  expect(await pendientes()).toBe(1);
  await nats.unpause();
  await vi.waitFor(async () => expect(await pendientes()).toBe(0), { timeout: 10_000 });
});
test('un evento entregado dos veces se procesa una sola vez', async () => {
  const handler = vi.fn();
  await consumeEvents({ ..., handler });
  await publicarDosVeces(nc, evento());            // mismo event_id, sin Nats-Msg-Id
  await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
});
test('tras 5 fallos el mensaje va a dlq.<type>', async () => {
  const handler = vi.fn().mockRejectedValue(new Error('boom'));
  await consumeEvents({ ..., handler });
  await publicar(nc, evento('tenant.creado'));
  expect((await siguienteMensaje(nc, 'dlq.tenant.creado')).event_id).toBeDefined();
  expect(handler).toHaveBeenCalledTimes(5);
});
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/platform test -- outbox consumer` — Expected: FAIL.
- [ ] **Step 3: Implementar** las funciones de Interfaces (backoff del consumidor en pruebas configurable a ms para no tardar).
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): outbox, inbox y consumidores con DLQ`.

---

### Task 5: `packages/platform` · HTTP, auth y observabilidad

**Files:**
- Create: `packages/platform/src/{http/errors.ts, http/plugin.ts, observability.ts, testing/jwks.ts}`
- Test: `packages/platform/test/plugin.test.ts`

**Interfaces:**
- Consumes: `tokenClaimsSchema`, `apiErrorSchema`, `ErrorCode`, `Rol` (Task 2).
- Produces:
  - `class AppError extends Error { constructor(code: ErrorCode, message: string, status: number, details?: unknown) }`
  - `platformPlugin: FastifyPluginAsync<{ servicio: string; jwksUrl: string; rutasPublicas?: string[] }>` (envuelto con `fastify-plugin`) — por petición: lee `x-trace-id` o genera uno; en rutas no públicas exige `Authorization: Bearer`, verifica con `jose.createRemoteJWKSet(jwksUrl)` (alg `EdDSA`, `issuer: 'svc-identidad'`) y valida claims con `tokenClaimsSchema`; decora `request.ctx: { tenantId: string; usuarioId: string; rol: Rol; mfa: boolean; traceId: string }` (en rutas públicas solo `traceId`). Error handler: `AppError` → su status/código; error de validación Zod o de esquema Fastify → 400 `VALIDACION`; resto → 500 `INTERNO` sin filtrar detalles. Logger hijo por petición con `servicio`, `tenant_id`, `trace_id`.
  - `requireRole(...roles: Rol[]): preHandlerHookHandler` → 403 `PROHIBIDO`.
  - `createLogger(servicio: string): pino.Logger`; `initTelemetry(servicio: string): void` (SDK Node de OpenTelemetry con exportador OTLP si `OTEL_EXPORTER_OTLP_ENDPOINT` existe; no-op si no).
  - `startTestJwks(): Promise<{ url: string; sign(claims: object, o?: { expiresIn?: string; otraLlave?: boolean }): Promise<string>; stop(): Promise<void> }>`.

- [ ] **Step 1: Escribir las pruebas que fallan** (app Fastify de prueba con ruta `/privada`, `/solo-admin` con `requireRole('admin')`, `/publica` en `rutasPublicas`, `/explota` que lanza `Error`).

```ts
test('sin token → 401 NO_AUTENTICADO', async () => {
  const r = await app.inject('/privada');
  expect(r.statusCode).toBe(401); expect(r.json().code).toBe('NO_AUTENTICADO');
});
test.each([
  ['firmado con otra llave', { otraLlave: true }],
  ['expirado', { expiresIn: '-1m' }],
])('Review Focus 5: token %s → 401', async (_n, o) => {
  const t = await jwks.sign(claims, o);
  expect((await app.inject({ url: '/privada', headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(401);
});
test('Review Focus 5: token sin tid → 401', async () => {
  const t = await jwks.sign({ sub: U, rol: 'admin', mfa: true });
  expect((await app.inject({ url: '/privada', headers: auth(t) })).statusCode).toBe(401);
});
test('token válido expone request.ctx', async () => {
  const r = await app.inject({ url: '/privada', headers: auth(await jwks.sign(claims)) });
  expect(r.json()).toMatchObject({ tenantId: T, usuarioId: U, rol: 'recepcion' });
});
test('rol insuficiente → 403 PROHIBIDO', async () => {
  const r = await app.inject({ url: '/solo-admin', headers: auth(await jwks.sign(claims)) });
  expect(r.json().code).toBe('PROHIBIDO');
});
test('ruta pública no exige token y propaga x-trace-id', async () => {
  const r = await app.inject({ url: '/publica', headers: { 'x-trace-id': 't1' } });
  expect(r.statusCode).toBe(200); expect(r.json().traceId).toBe('t1');
});
test('error inesperado → 500 INTERNO sin mensaje interno', async () => {
  const r = await app.inject({ url: '/explota', headers: auth(await jwks.sign(claims)) });
  expect(r.json()).toEqual({ code: 'INTERNO', message: 'Error interno' });
});
test('los logs incluyen servicio, tenant_id y trace_id', async () => { /* logger con stream en memoria */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/platform test -- plugin` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): plugin HTTP con JWT, errores y logs`.

---

### Task 6: `svc-identidad` · esquema y registro de consultorio

**Files:**
- Create: `apps/svc-identidad/migrations/001_better_auth.sql` (generado con `npx @better-auth/cli generate` para Postgres con plugin `twoFactor`), `002_identidad.sql`
- Create: `apps/svc-identidad/src/{server.ts, auth.ts, db/schema.ts, routes/registro.ts}`
- Test: `apps/svc-identidad/test/registro.test.ts`, `apps/svc-identidad/test/aislamiento.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - Tablas `002_identidad.sql` (spec §3.2): `tenant(id, nombre, slug unique, zona_horaria, plan default 'piloto', estado_suscripcion default 'piloto', creado_en)` y `usuario` = tabla `user` de Better Auth (globales, sin RLS); `membresia(tenant_id, usuario_id, rol, creado_en, pk(tenant_id, usuario_id))`, `perfil_medico(tenant_id, usuario_id, cedula_profesional, especialidad, cedula_especialidad, institucion)`, `datos_fiscales(tenant_id pk, rfc, razon_social, regimen_fiscal, cp, pac_emisor_id)` con `rlsPolicySql`; más `OUTBOX_INBOX_SQL`.
  - Función `fn_membresias_usuario(p_usuario uuid) RETURNS TABLE(tenant_id uuid, nombre text, slug text, rol text)` `SECURITY DEFINER` (dueño `identidad_migrator`, `search_path` fijo) — único acceso a membresías sin tenant activo.
  - `auth` (Better Auth) montado en `/auth/*` con email+password y plugin `twoFactor` (TOTP).
  - `buildServer(o: { pool: pg.Pool; nc: NatsConnection; jwksUrl: string; jwtPrivateJwk: JWK }): Promise<FastifyInstance>`
  - `POST /registro` (pública) body `{ nombreConsultorio: string(2..120); slug: /^[a-z0-9-]{3,40}$/; zonaHoraria: zona IANA válida (Intl.supportedValuesOf('timeZone')); admin: { nombre; email; password(min 10) } }` → 201 `{ tenantId, usuarioId }` y evento `TenantCreado` + `UsuarioVinculado(rol 'admin')`.
- Orden de `POST /registro`: verificar slug y email libres → crear usuario con `auth.api.signUpEmail` → en una transacción (`withTenant(nuevoTenantId)`) insertar `tenant`, `membresia(admin)` y eventos → si la transacción falla, borrar el usuario creado (compensación) y relanzar. Choques de unicidad (`23505`) → 409 `CONFLICTO`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('registro crea tenant, admin y emite eventos', async () => {
  const r = await app.inject({ method: 'POST', url: '/registro', payload: registro('uno') });
  expect(r.statusCode).toBe(201);
  const tipos = (await migrator.query('select type from outbox order by creado_en')).rows.map(x => x.type);
  expect(tipos).toEqual(['tenant.creado', 'usuario.vinculado']);
});
test('Review Focus 3: slug repetido → 409 y sin usuario huérfano', async () => {
  await registrar('uno', 'a@x.mx');
  const r = await app.inject({ method: 'POST', url: '/registro', payload: registro('uno', 'b@x.mx') });
  expect(r.statusCode).toBe(409); expect(r.json().code).toBe('CONFLICTO');
  expect((await migrator.query(`select 1 from "user" where email='b@x.mx'`)).rowCount).toBe(0);
});
test('Review Focus 3: email repetido → 409 y sin tenant creado', async () => {
  await registrar('uno', 'a@x.mx');
  expect((await app.inject({ method: 'POST', url: '/registro', payload: registro('dos', 'a@x.mx') })).statusCode).toBe(409);
  expect((await migrator.query(`select 1 from tenant where slug='dos'`)).rowCount).toBe(0);
});
test.each([['zona inválida', { zonaHoraria: 'Mars/Base' }], ['slug con mayúsculas', { slug: 'Uno' }], ['password corta', { admin: { password: '123' } }]])(
  '%s → 400 VALIDACION', async (_n, cambio) => { /* ... */ });
// aislamiento.test.ts
test('identidad_app no ve membresías de otro tenant', async () => {
  const [a, b] = [await registrar('a'), await registrar('b')];
  const r = await withTenant(appPool, a.tenantId, tx => tx.query('select tenant_id from membresia'));
  expect(r.rows.every(x => x.tenant_id === a.tenantId)).toBe(true);
});
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/svc-identidad test` — Expected: FAIL.
- [ ] **Step 3: Implementar** migraciones, `auth.ts`, `server.ts` (usa `platformPlugin` con `rutasPublicas: ['/registro', '/auth/*', '/.well-known/jwks.json', '/tenants/mios', '/sesion/tenant']` — las dos últimas no usan JWT de tenant sino sesión Better Auth, verificada en la propia ruta con `auth.api.getSession`; arranca `startOutboxPublisher`) y `routes/registro.ts`.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(identidad): registro de consultorio con RLS y eventos`.

---

### Task 7: `svc-identidad` · token de tenant, MFA, miembros, perfil y datos fiscales

**Files:**
- Create: `apps/svc-identidad/src/{tokens.ts, routes/sesion.ts, routes/miembros.ts, routes/perfil.ts, routes/datos-fiscales.ts}`
- Test: `apps/svc-identidad/test/{sesion.test.ts, miembros.test.ts, perfil.test.ts}`

**Interfaces:**
- Consumes: Task 6.
- Produces:
  - `firmarTokenTenant(claims: TokenClaims, jwk: JWK): Promise<string>` — EdDSA, `issuer: 'svc-identidad'`, expira en **15 min**.
  - `GET /.well-known/jwks.json` (pública) → llave pública.
  - `GET /tenants/mios` (sesión Better Auth) → `[{ tenantId, nombre, slug, rol }]` vía `fn_membresias_usuario`.
  - `POST /sesion/tenant` (sesión Better Auth) body `{ tenantId }` → 200 `{ token }`. Reglas: no miembro → 403 `PROHIBIDO`; rol `admin` o `medico` sin `twoFactorEnabled` → 403 `MFA_REQUERIDA`; claim `mfa = twoFactorEnabled`.
  - `POST /miembros` (`admin`) body `{ email, nombre, rol, passwordTemporal }` → 201; crea usuario si no existe, crea membresía, emite `UsuarioVinculado`. Ya miembro → 409.
  - `DELETE /miembros/:usuarioId` (`admin`) → 204; borra membresía, emite `UsuarioDesvinculado`. No puede eliminar al último `admin` → 409.
  - `PUT /medicos/:usuarioId/perfil` (`admin`, o el propio usuario si es `medico`) body `{ cedulaProfesional: /^\d{7,8}$/, especialidad?, cedulaEspecialidad?, institucion? }` → 200; emite `MedicoActualizado`. El usuario debe ser miembro con rol `medico` → si no, 404.
  - `PUT /datos-fiscales` (`admin`) body `{ rfc: RFC persona física o moral (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/), razonSocial, regimenFiscal: /^\d{3}$/, cp: /^\d{5}$/ }` → 200.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('admin sin MFA → 403 MFA_REQUERIDA', async () => {
  const s = await iniciarSesion(admin);
  const r = await pedirToken(s, tenantId);
  expect(r.json().code).toBe('MFA_REQUERIDA');
});
test('admin con TOTP activo obtiene token con claims correctos y exp 15 min', async () => {
  const s = await activarTotpEIniciarSesion(admin);       // otplib genera el código
  const { token } = (await pedirToken(s, tenantId)).json();
  const { payload } = await jwtVerify(token, jwks, { issuer: 'svc-identidad' });
  expect(payload).toMatchObject({ sub: admin.id, tid: tenantId, rol: 'admin', mfa: true });
  expect(payload.exp! - payload.iat!).toBe(900);
});
test('recepción sin MFA sí obtiene token', async () => { /* ... */ });
test('usuario de otro consultorio → 403 PROHIBIDO', async () => { /* ... */ });
test('Review Focus 1: miembro removido no obtiene token nuevo', async () => {
  const s = await iniciarSesion(recepcion);
  await borrarMiembro(adminToken, recepcion.id);
  expect((await pedirToken(s, tenantId)).json().code).toBe('PROHIBIDO');
});
test('no se puede eliminar al último admin → 409', async () => { /* ... */ });
test('recepción no puede invitar miembros → 403', async () => { /* ... */ });
test('perfil con cédula inválida → 400; médico de otro tenant → 404', async () => { /* ... */ });
test('perfil emite medico.actualizado', async () => { /* ... */ });
test('RFC inválido → 400 VALIDACION', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/svc-identidad test` — Expected: FAIL en los nuevos.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(identidad): token de tenant con MFA, miembros y perfiles`.

---

### Task 8: `svc-auditoria`

**Files:**
- Create: `apps/svc-auditoria/migrations/001_auditoria.sql`
- Create: `apps/svc-auditoria/src/{server.ts, cadena.ts, consumidor.ts, verificacion.ts, routes/eventos.ts}`
- Test: `apps/svc-auditoria/test/{cadena.test.ts, consumidor.test.ts, permisos.test.ts, verificacion.test.ts, eventos.test.ts}`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - Tablas (spec §3.7): `evento_auditoria(id uuid pk, tenant_id, secuencia bigint, ocurrido_en, actor_id, accion, recurso_tipo, recurso_id, servicio, detalle jsonb, hash_anterior text, hash text, unique(tenant_id, secuencia))` y `cadena(tenant_id pk, ultima_secuencia bigint, ultimo_hash text)`, ambas con RLS. `auditoria_app` solo `SELECT, INSERT` en `evento_auditoria` (`REVOKE UPDATE, DELETE`); `SELECT, INSERT, UPDATE` en `cadena`.
  - `HASH_GENESIS = '0'.repeat(64)`
  - `calcularHash(hashAnterior: string, registro: RegistroAuditoria): string` = `sha256Hex(hashAnterior + canonicalJson(registro))`, donde `RegistroAuditoria` = todas las columnas excepto `hash`.
  - `registrar(tx: pg.PoolClient, e: EventEnvelope): Promise<void>` — `SELECT ... FROM cadena ... FOR UPDATE` (o crea la fila con `HASH_GENESIS`), `secuencia = ultima + 1`, inserta, actualiza `cadena`. Mapeo: `accion = e.type`, `recurso_tipo` = prefijo del type, `recurso_id` = primer campo `*Id` de `data`, `servicio` = prefijo del type → servicio dueño, `detalle = e.data`, `id = e.event_id`.
  - `iniciarConsumidor(o: { pool; nc }): Promise<{ stop() }>` — `consumeEvents({ consumidor: 'auditoria', subjects: ['evt.>'], handler: registrar })`.
  - `verificarCadena(pool: pg.Pool, tenantId: string): Promise<{ valida: boolean; rotaEnSecuencia?: number }>`; tarea pg-boss diaria `verificar-cadenas` (03:00 `America/Mexico_City`) que recorre los tenants y registra `logger.error({ alerta: 'cadena_auditoria_rota', tenant_id, secuencia })`.
  - `GET /eventos?desde&hasta&limite(≤200)` (`admin`) → eventos del tenant del token, orden `secuencia desc`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('cada registro encadena con el anterior', async () => {
  await registrarN(A, 3);
  const filas = await leer(A);
  expect(filas[0].hash_anterior).toBe(HASH_GENESIS);
  expect(filas[1].hash_anterior).toBe(filas[0].hash);
  expect((await verificarCadena(app, A)).valida).toBe(true);
});
test('Review Focus 2: 50 eventos concurrentes → secuencias 1..50 sin huecos y cadena válida', async () => {
  await Promise.all(Array.from({ length: 50 }, () => withTenant(app, A, tx => registrar(tx, evento(A)))));
  expect((await leer(A)).map(f => Number(f.secuencia))).toEqual(range(1, 50));
  expect((await verificarCadena(app, A)).valida).toBe(true);
});
test('cadenas independientes por tenant', async () => { /* A y B empiezan en secuencia 1 */ });
test('alterar un registro (como superusuario) rompe la verificación en esa secuencia', async () => {
  await registrarN(A, 3);
  await superuser.query(`update evento_auditoria set detalle='{}' where secuencia=2`);
  expect(await verificarCadena(app, A)).toEqual({ valida: false, rotaEnSecuencia: 2 });
});
test('auditoria_app no puede UPDATE ni DELETE', async () => {
  await expect(withTenant(app, A, tx => tx.query('delete from evento_auditoria'))).rejects.toThrow(/permission denied/);
});
test('consume tenant.creado desde NATS y lo registra una sola vez aunque llegue duplicado', async () => { /* ... */ });
test('GET /eventos solo devuelve eventos del tenant del token y exige admin', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/svc-auditoria test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(auditoria): bitácora con cadena hash y verificación diaria`.

---

### Task 9: `gateway`

**Files:**
- Create: `apps/gateway/src/{server.ts, rutas.ts}`
- Test: `apps/gateway/test/gateway.test.ts`

**Interfaces:**
- Consumes: `platformPlugin`, `startTestJwks` (Task 5).
- Produces:
  - `buildGateway(o: { jwksUrl: string; destinos: { identidad: string; auditoria: string }; limitePublicoPorMin?: number /*60*/ }): Promise<FastifyInstance>`
  - Rutas (`@fastify/http-proxy`, timeout de 10 s hacia el destino):
    - Públicas (sin JWT, con `@fastify/rate-limit` por IP = `limitePublicoPorMin`): `POST /api/identidad/registro`, `/api/identidad/auth/*`, `GET /api/identidad/.well-known/jwks.json`.
    - Con sesión Better Auth (sin JWT de tenant, cookie/bearer reenviados): `GET /api/identidad/tenants/mios`, `POST /api/identidad/sesion/tenant`.
    - Protegidas (JWT de tenant obligatorio): resto de `/api/identidad/*`, `/api/auditoria/*`.
  - Reenvía `Authorization` y `x-trace-id` (generado si falta). Destino caído → 503 `{ code: 'INTERNO', message: 'Servicio no disponible' }`.

- [ ] **Step 1: Escribir las pruebas que fallan** (destinos simulados con Fastify que devuelven los headers recibidos).

```ts
test('Review Focus 5: ruta protegida sin token o con token ajeno → 401', async () => { /* sin token, otraLlave */ });
test('token válido se reenvía con x-trace-id', async () => {
  const r = await gw.inject({ url: '/api/auditoria/eventos', headers: auth(await jwks.sign(claims)) });
  expect(r.json().headers['x-trace-id']).toBeTruthy();
  expect(r.json().headers.authorization).toMatch(/^Bearer /);
});
test('registro es público', async () => { expect((await gw.inject({ method: 'POST', url: '/api/identidad/registro', payload: {} })).statusCode).toBe(200); });
test('rate limit en rutas públicas → 429 tras el límite', async () => {
  const gw2 = await buildGateway({ ..., limitePublicoPorMin: 2 });
  for (let i = 0; i < 2; i++) await gw2.inject(registroReq());
  expect((await gw2.inject(registroReq())).statusCode).toBe(429);
});
test('destino caído → 503', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/gateway test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(gateway): enrutamiento, JWT y rate limit`.

---

### Task 10: Imágenes, compose completo y prueba E2E de la fase

**Files:**
- Create: `docker/Dockerfile.service` (arg `APP`; `turbo prune --docker` → build → imagen `node:24-slim` sin dev deps, usuario no root; al arrancar corre `runMigrations` con la URL del migrator y luego el servidor)
- Modify: `docker-compose.yml` (agrega `gateway:8080`, `svc-identidad`, `svc-auditoria` con perfil `app`)
- Create: `tests/e2e/fase0.e2e.test.ts`

**Interfaces:**
- Consumes: Tasks 6–9.

- [ ] **Step 1: Escribir la prueba E2E que falla** (contra `http://localhost:8080`):

```ts
test('registro → MFA → token → auditoría ve el alta del consultorio', async () => {
  const { tenantId } = await post('/api/identidad/registro', registro('e2e-uno'));
  const sesion = await iniciarSesionConTotp('admin@e2e-uno.mx');
  const { token } = await post('/api/identidad/sesion/tenant', { tenantId }, sesion);
  await vi.waitFor(async () => {
    const eventos = await get('/api/auditoria/eventos', token);
    expect(eventos.map(e => e.accion)).toEqual(expect.arrayContaining(['tenant.creado', 'usuario.vinculado']));
  }, { timeout: 15_000 });
});
test('el admin de un consultorio no ve la auditoría de otro', async () => { /* dos registros, tokens cruzados */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/e2e test` — Expected: FAIL (servicios no levantados).
- [ ] **Step 3: Crear el Dockerfile y ampliar compose.**
- [ ] **Step 4: Verificar.** Run: `docker compose --profile app up -d --build --wait && pnpm --filter @consultorio/e2e test` — Expected: PASS.
- [ ] **Step 5: Commit** `test: E2E de la fase 0 y servicios en compose`.

---

### Task 11: CI con GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: scripts raíz (Task 1), Dockerfile y E2E (Task 10).

- [ ] **Step 1: Crear el workflow** con jobs en `ubuntu-latest`:
  1. `verificar`: pnpm (cache) → `pnpm install --frozen-lockfile` → `pnpm turbo lint typecheck test --filter=...[origin/main]` (Testcontainers funciona con el Docker del runner).
  2. `e2e` (needs `verificar`): `docker compose --profile app up -d --build --wait` → `pnpm --filter @consultorio/e2e test`.
  3. `imagenes` (solo en `main`, needs `e2e`): build de la imagen de cada app afectada con `docker/Dockerfile.service` y push a ECR (autenticación por OIDC con `aws-actions/configure-aws-credentials`, región `mx-central-1`).
  4. `desplegar` (solo en `main`, needs `imagenes`, environment `produccion` con aprobación manual): por cada app afectada, `aws ecs update-service --force-new-deployment` sobre el servicio de Task 12. Se activa cuando exista la infraestructura desplegada.
- [ ] **Step 2: Validar la sintaxis.** Run: `npx --yes @action-validator/cli .github/workflows/ci.yml` — Expected: sin errores.
- [ ] **Step 3: Verificar que una prueba de aislamiento rota bloquea el pipeline**: cambiar temporalmente la política RLS en una migración de prueba, correr `pnpm turbo test` — Expected: FAIL; revertir.
- [ ] **Step 4: Commit** `ci: pipeline de verificación, E2E e imágenes`.

---

### Task 12: Infraestructura base con AWS CDK

**Files:**
- Create: `infra/bin/app.ts`, `infra/lib/{red.ts, datos.ts, mensajeria.ts, servicios.ts}`, `infra/cdk.json`
- Test: `infra/test/infra.test.ts`

**Interfaces:**
- Produces stacks (todas con `env: { region: 'mx-central-1' }`):
  - `RedStack`: VPC de 2 AZ, subredes públicas y privadas, 1 NAT.
  - `DatosStack`: llave KMS; RDS PostgreSQL 16 (`db.t4g.medium`, cifrado con la KMS, `backupRetention: 35 días`, `deletionProtection: true`, subred privada); bucket S3 con cifrado KMS, bloqueo de acceso público y versionado.
  - `MensajeriaStack`: NATS (`nats:2 -js`) en ECS Fargate con volumen EFS para JetStream, solo accesible desde la VPC.
  - `ServiciosStack`: clúster ECS; servicios Fargate `gateway` (detrás de un ALB con HTTPS), `svc-identidad`, `svc-auditoria` (privados); secretos de BD en Secrets Manager; logs a CloudWatch; Service Connect para DNS interno.

- [ ] **Step 1: Escribir las pruebas que fallan** (`aws-cdk-lib/assertions`):

```ts
test('RDS Postgres 16 cifrado, con PITR de 35 días y protección de borrado', () => {
  datos.hasResourceProperties('AWS::RDS::DBInstance', Match.objectLike({
    Engine: 'postgres', EngineVersion: Match.stringLikeRegexp('^16'),
    StorageEncrypted: true, BackupRetentionPeriod: 35, DeletionProtection: true, PubliclyAccessible: false }));
});
test('S3 cifrado con KMS y sin acceso público', () => { /* BucketEncryption aws:kms, PublicAccessBlockConfiguration todo true */ });
test('todas las stacks en mx-central-1', () => { for (const s of stacks) expect(s.region).toBe('mx-central-1'); });
test('solo el gateway es público', () => {
  servicios.resourceCountIs('AWS::ECS::Service', 3);
  servicios.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
});
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/infra test` — Expected: FAIL.
- [ ] **Step 3: Implementar** las stacks.
- [ ] **Step 4: Verificar.** Run: `pnpm --filter @consultorio/infra test && pnpm --filter @consultorio/infra exec cdk synth --quiet` — Expected: PASS y síntesis sin errores. (El `cdk deploy` real lo hace el usuario con su cuenta AWS; no es parte de este plan.)
- [ ] **Step 5: Commit** `feat(infra): red, datos, mensajería y servicios en AWS México`.

---

## Criterio de terminado de la Fase 0

- `pnpm turbo lint typecheck test` en verde.
- `docker compose --profile app up` + E2E en verde.
- `cdk synth` sin errores.
- Un consultorio se registra, su admin activa TOTP, obtiene token y ve en auditoría su alta; un segundo consultorio no ve nada del primero.
