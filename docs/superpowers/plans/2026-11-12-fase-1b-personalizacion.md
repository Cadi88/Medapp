# Fase 1 · Entrega 2 — Personalización del consultorio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada consultorio sube su logo, elige su color y captura sus datos de contacto, y todo su equipo ve la app con esa identidad; además el consultorio guarda país y moneda.

**Architecture:** Las reglas puras (país, teléfono, contraste de color) viven en `packages/contracts` para que identidad y el sitio web validen igual. `packages/platform` gana un almacenamiento de archivos (`Almacen`, S3/MinIO) reutilizable por la Fase 2. Identidad guarda la personalización en `tenant`, procesa el logo con `sharp` y lo guarda en el almacenamiento; el sitio web lo sirve por una ruta propia y aplica el color con variables CSS.

**Tech Stack:** Lo existente (Node 24, TS estricto ESM, Fastify 5, Zod 4, Postgres 16, NATS, Next.js 16, Vitest, Testcontainers, Playwright) más `@aws-sdk/client-s3`, `sharp` y MinIO (imagen `cgr.dev/chainguard/minio`, la misma de compose).

**Spec:** `docs/superpowers/specs/2026-11-12-fase-1b-personalizacion-design.md` (y la spec general §1.6, §3.2, §3.9)

## Global Constraints

- Todas las Global Constraints de `docs/superpowers/plans/2026-11-11-fase-1a-web-agenda.md` siguen vigentes (capas dominio/rutas/datos, ACID con outbox en la misma transacción, `no-explicit-any`, cobertura ≥ 80% de líneas y ramas por paquete con `test/unit` y `test/integration`, $0 sin `cdk deploy`/`bootstrap`/`aws`, commit por tarea).
- País: `pais ∈ {'MX','BO'}`, moneda `∈ {'MXN','BOB'}`; `PAISES_HABILITADOS = ['MX']`; por omisión `MX`/`MXN`.
- Teléfono guardado siempre en E.164: México `+52` + 10 dígitos; Bolivia `+591` + 8 dígitos.
- Color: `#rrggbb` en minúsculas; contraste con `#ffffff` ≥ **3:1**; texto encima = `#ffffff` o `#000000`, el de mayor contraste WCAG.
- Logo: solo PNG, JPEG o WebP detectados por bytes; archivo ≤ **1 MB**; `limitInputPixels` = **25 000 000**; salida PNG con lado mayor ≤ **512 px**, sin agrandar y sin metadatos; llave `logos/{tenantId}/{uuidv7}.png`.
- Cuerpo HTTP de hasta **2 MB** solo en `PUT /consultorio/logo` (gateway e identidad); el archivo se sube crudo, no `multipart/form-data`.
- Nunca una transacción abierta durante una llamada al almacenamiento.
- El almacenamiento nunca se expone a internet: el navegador obtiene el logo solo a través de Next (`/consultorio/logo`).
- Textos de la interfaz exactos (spec §5): "El logo debe pesar menos de 1 MB", "Sube una imagen PNG, JPG o WebP", "Elige un color más oscuro".

## Review Focus

1. **Dos administradores suben un logo al mismo tiempo** → queda exactamente uno, su objeto existe y `GET /consultorio/logo` responde 200; el otro objeto se borra. Prueba en Task 3.
2. **Un archivo que dice ser PNG pero es SVG, HTML o texto** → `400`, nada guardado en el almacenamiento ni en la base. Prueba en Task 3.
3. **Imagen pequeña en bytes pero de dimensiones enormes (bomba de descompresión)** → `400` sin agotar memoria. Prueba en Task 3.
4. **Un consultorio intenta obtener el logo de otro** (otro token, o adivinando llaves) → solo recibe el suyo o 404; la ruta ignora cualquier parámetro y usa el `tid` del token. Prueba en Task 3 y Task 4.
5. **El admin quita el logo con el equipo usando la app** → el encabezado muestra el nombre sin imagen rota en la siguiente navegación. Prueba en Task 4.

---

## Mapa de archivos

```
packages/contracts/src/
  paises/{tipos,mx,bo,index}.ts     ReglasPais, reglasDe, PAISES_HABILITADOS, normalizarTelefono
  marca/color.ts                    contraste, colorDeTexto, colorValidoSobreBlanco
  events/identidad.ts               TenantCreado v2 (+TenantCreadoV1), ConsultorioActualizado
  api/identidad.ts                  consultorioSchema extendido, personalizacionSchema
packages/platform/src/
  almacen/{almacen,s3}.ts           Almacen, crearAlmacenS3, asegurarBucket
  testing/minio.ts                  startMinio
apps/svc-identidad/
  migrations/005_personalizacion.sql
  src/dominio/logo.ts               detectarFormato
  src/logo/procesar.ts              procesarLogo (sharp)
  src/routes/{registro,consultorio}.ts, src/routes/logo.ts
apps/svc-agenda/src/consumidor.ts   acepta tenant.creado v1 y v2
apps/gateway/src/server.ts          límite 2 MB en la ruta del logo
apps/web/src/
  features/consultorio/**           página "Mi consultorio", acciones, tema
  app/(app)/consultorio/page.tsx, app/consultorio/logo/route.ts
  app/(app)/layout.tsx, features/navegacion/**, features/sesion/** (país en registro)
  features/bitacora/logica/acciones.ts
docker-compose.yml, scripts/generar-dev-env.sh, .env.example, infra/lib/servicios.ts, README.md
tests/e2e/test/personalizacion.e2e.test.ts, tests/e2e-web/test/personalizacion.spec.ts
```

---

### Task 1: País y moneda del consultorio + reglas puras compartidas

**Files:**
- Create: `packages/contracts/src/paises/{tipos,mx,bo,index}.ts`, `packages/contracts/src/marca/color.ts`, `apps/svc-identidad/migrations/005_personalizacion.sql`
- Modify: `packages/contracts/src/{index.ts,events/identidad.ts,api/identidad.ts}`, `apps/svc-identidad/src/routes/{registro,consultorio}.ts`, `apps/svc-identidad/src/validadores.ts`, `apps/svc-agenda/src/consumidor.ts`
- Test: `packages/contracts/test/unit/{paises,color,eventos-identidad}.test.ts`, `apps/svc-identidad/test/integration/{registro,consultorio,migracion-005}.test.ts`, `apps/svc-identidad/test/unit/migraciones.test.ts`, `apps/svc-agenda/test/integration/consumidor.test.ts`

**Interfaces:**
- Produces:
  - `type CodigoPais = 'MX' | 'BO'`; `interface ReglasPais { codigo; moneda: 'MXN' | 'BOB'; prefijoTelefonico: '+52' | '+591'; digitosNacionales: 10 | 8; zonasHorarias: string[] }`; `reglasDe(pais: CodigoPais): ReglasPais`; `PAISES_HABILITADOS: readonly CodigoPais[] = ['MX']`.
  - `normalizarTelefono(entrada: string, pais: CodigoPais): string | null`: quita espacios, guiones, paréntesis y puntos; acepta solo dígitos nacionales, `prefijo + dígitos`, y en MX además `+521` + 10 dígitos (lo convierte a `+52`); devuelve E.164 o `null`.
  - `contraste(a: string, b: string): number` (WCAG 2.x, luminancia relativa); `colorDeTexto(fondo: string): '#ffffff' | '#000000'`; `colorValidoSobreBlanco(color: string): boolean` (formato `#rrggbb` minúsculas y `contraste(color, '#ffffff') >= 3`).
  - `TenantCreado = defineEvent('tenant.creado', 2, { tenantId, nombre, slug, zonaHoraria, adminUsuarioId, pais, moneda })`; `TenantCreadoV1` (el esquema v1 actual).
  - `consultorioSchema` agrega `nombreComercial: string | null, direccion: string | null, telefono: string | null, colorPrimario: string | null, colorTexto: '#ffffff' | '#000000' | null, logoVersion: number, pais, moneda`.
  - Migración 005: columnas de la spec §4.1 con sus `CHECK`; `GRANT UPDATE (nombre_comercial, direccion, telefono, color_primario, logo_key, logo_version) ON tenant TO identidad_app` (con la sustitución de nombre de rol que usan las pruebas, como en 002–004).
  - `POST /registro` acepta `pais?: CodigoPais` (por omisión `'MX'`; fuera de `PAISES_HABILITADOS` → 400) y guarda la moneda de `reglasDe(pais)`; emite `TenantCreado` v2.
  - Consumidor de agenda: acepta `tenant.creado@1` y `@2` (la zona horaria es lo único que usa).

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test.each([
  ['55 1234 5678', 'MX', '+525512345678'], ['+52 (55) 1234-5678', 'MX', '+525512345678'], ['+5215512345678', 'MX', '+525512345678'],
  ['7123 4567', 'BO', '+59171234567'], ['12345', 'MX', null], ['+59171234567', 'MX', null],
])('normalizarTelefono(%s, %s) = %s', (e, p, r) => expect(normalizarTelefono(e, p as CodigoPais)).toBe(r));
test('colorDeTexto elige el de mayor contraste', () => {
  expect(colorDeTexto('#1e3a8a')).toBe('#ffffff'); expect(colorDeTexto('#fde68a')).toBe('#000000');
});
test('colorValidoSobreBlanco: azul oscuro sí, amarillo pálido no, formato inválido no', () => {
  expect(colorValidoSobreBlanco('#1e3a8a')).toBe(true); expect(colorValidoSobreBlanco('#fde68a')).toBe(false);
  expect(colorValidoSobreBlanco('#1E3A8A')).toBe(false); expect(colorValidoSobreBlanco('azul')).toBe(false);
});
test('contraste blanco/negro = 21', () => expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 1));
// identidad
test('registro sin país → MX/MXN y tenant.creado v2', async () => { /* ... */ });
test('registro con país BO → 400 (no habilitado)', async () => { /* ... */ });
test('migración 005 deja consultorios existentes en MX/MXN y logo_version 0', async () => { /* ... */ });
test('identidad_app no puede actualizar nombre, slug, pais ni moneda', async () => { /* UPDATE → 42501 */ });
test('GET /consultorio devuelve pais, moneda y personalización nula', async () => { /* ... */ });
// agenda
test('consumidor acepta tenant.creado v1 y v2', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/contracts --filter=@consultorio/svc-identidad --filter=@consultorio/svc-agenda` — Expected: FAIL en las nuevas.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm turbo run typecheck lint test --filter='!@consultorio/e2e' --filter='!@consultorio/e2e-web'` — Expected: PASS con cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(identidad): país y moneda del consultorio y reglas por país`.

---

### Task 2: Almacenamiento de archivos en la plataforma

**Files:**
- Create: `packages/platform/src/almacen/{almacen,s3}.ts`, `packages/platform/src/testing/minio.ts`
- Modify: `packages/platform/src/index.ts`, `packages/platform/src/testing/index.ts`, `packages/platform/package.json`
- Test: `packages/platform/test/unit/almacen-config.test.ts`, `packages/platform/test/integration/almacen.test.ts`

**Interfaces:**
- Produces:
  - `interface Almacen { guardar(llave: string, bytes: Uint8Array, tipo: string): Promise<void>; leer(llave: string): Promise<{ bytes: Uint8Array; tipo: string } | null>; borrar(llave: string): Promise<void> }`.
  - `configAlmacenDesdeEnv(env): ConfigAlmacen` con `S3_BUCKET` y `S3_REGION` obligatorias, y `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` opcionales (si hay `S3_ENDPOINT` se exigen las credenciales).
  - `crearAlmacenS3(c: ConfigAlmacen): Almacen` (`forcePathStyle: true` cuando hay endpoint); `leer` devuelve `null` si el objeto no existe (`NoSuchKey`/404); `borrar` de una llave inexistente no falla.
  - `asegurarBucket(c: ConfigAlmacen): Promise<void>`: crea el bucket solo si hay `S3_ENDPOINT` y no existe; sin endpoint no hace nada.
  - `startMinio(): Promise<{ config: ConfigAlmacen; stop(): Promise<void> }>` en `@consultorio/platform/testing`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test('config: con S3_ENDPOINT sin credenciales → error; sin endpoint no las exige', () => { /* ... */ });
test('guardar → leer devuelve los mismos bytes y tipo', async () => { /* MinIO real */ });
test('leer una llave inexistente → null', async () => { /* ... */ });
test('borrar una llave inexistente no falla', async () => { /* ... */ });
test('asegurarBucket es idempotente', async () => { /* llamar dos veces */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/platform test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando — Expected: PASS con cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(platform): almacenamiento de archivos S3/MinIO`.

---

### Task 3: Identidad · personalización y logo (+ gateway y compose)

**Files:**
- Create: `apps/svc-identidad/src/dominio/logo.ts`, `apps/svc-identidad/src/logo/procesar.ts`, `apps/svc-identidad/src/routes/logo.ts`
- Modify: `apps/svc-identidad/src/{server.ts,main.ts,routes/consultorio.ts}`, `apps/svc-identidad/package.json`, `packages/contracts/src/{events/identidad.ts,api/identidad.ts}`, `apps/gateway/src/server.ts`, `docker-compose.yml`, `scripts/generar-dev-env.sh`, `.env.example`
- Test: `apps/svc-identidad/test/unit/{logo-formato,personalizacion}.test.ts`, `apps/svc-identidad/test/integration/{personalizacion,logo}.test.ts`, `apps/gateway/test/integration/gateway.test.ts`

**Interfaces:**
- Consumes: Task 1 (reglas, `consultorioSchema`), Task 2 (`Almacen`, `startMinio`).
- Produces:
  - `ConsultorioActualizado = defineEvent('consultorio.actualizado', 1, { campos: z.array(z.enum(['nombreComercial','direccion','telefono','colorPrimario','logo'])).min(1) })`.
  - `personalizacionSchema` (contracts): objeto estricto con `nombreComercial?: string(2..120, trim) | null`, `direccion?: string(≤300, trim) | null`, `telefono?: string | null`, `colorPrimario?: string | null`; al menos un campo.
  - `detectarFormato(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | null` (firmas: PNG `89 50 4E 47 0D 0A 1A 0A`; JPEG `FF D8 FF`; WebP `RIFF????WEBP`).
  - `procesarLogo(bytes: Uint8Array): Promise<Uint8Array>`: `sharp(bytes, { limitInputPixels: 25_000_000 })`, `.rotate()`, `.resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })`, `.png()`; cualquier error de `sharp` → `AppError('VALIDACION', 'Sube una imagen PNG, JPG o WebP', 400)`. `sharp` se importa en el nivel superior del módulo, que `server.ts` importa al arrancar.
  - `buildServer` recibe además `almacen: Almacen`; `main.ts` lo crea con `configAlmacenDesdeEnv` y llama `asegurarBucket` antes de escuchar.
  - Rutas (spec §4.6):
    - `PATCH /consultorio/personalizacion` (`requireAdmin`): valida con `personalizacionSchema`; teléfono con `normalizarTelefono(valor, tenant.pais)` (null → 400 `campo: telefono`); color con `colorValidoSobreBlanco` (si no → 400 "Elige un color más oscuro"); en una transacción `SELECT … FOR UPDATE`, calcula los campos que cambian, si ninguno → 200 sin escribir ni emitir; si hay → `UPDATE` + `ConsultorioActualizado`.
    - `PUT /consultorio/logo` (`requireAdmin`, `bodyLimit: 2 * 1024 * 1024`, lector de cuerpo `Buffer` para `image/png|image/jpeg|image/webp`): `> 1 MB` → 400 "El logo debe pesar menos de 1 MB"; `detectarFormato` null → 400; `procesarLogo`; `almacen.guardar('logos/{tid}/{uuidv7}.png')`; transacción con `FOR UPDATE`: lee `logo_key` anterior, escribe la nueva, `logo_version = logo_version + 1`, `ConsultorioActualizado { campos: ['logo'] }`; después del commit `almacen.borrar(anterior)` (error → log `warn` con la llave, sin relanzar) → 200 `{ logoVersion }`. Error del almacenamiento al guardar → 503 `INTERNO` "Servicio no disponible".
    - `DELETE /consultorio/logo` (`requireAdmin`): igual con `logo_key = NULL` (y `logo_version + 1`); sin logo → 204 sin emitir.
    - `GET /consultorio/logo` (cualquier miembro): lee `logo_key` del `tid` del token; null → 404; `almacen.leer` null → 404; error → 503; si no → `image/png` con `Cache-Control: private, max-age=86400`.
    - `GET /consultorio` agrega `colorTexto = colorPrimario ? colorDeTexto(colorPrimario) : null` y `logoVersion = logo_key ? logo_version : 0` (0 significa "sin logo", también después de quitarlo), y nunca llama al almacenamiento.
  - Gateway: `bodyLimit` de 2 MB solo para `PUT /api/identidad/consultorio/logo`; el resto conserva el actual.
  - Compose: `svc-identidad` con `S3_ENDPOINT: http://minio:9000`, `S3_REGION: us-east-1`, `S3_BUCKET: consultorio-archivos`, credenciales de MinIO desde `.env` (`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, con los mismos valores por omisión de compose) y `depends_on: minio (healthy)`. `generar-dev-env.sh` agrega las variables de MinIO que falten.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test.each([['png', PNG_1PX], ['jpeg', JPEG_1PX], ['webp', WEBP_1PX]])('detecta %s', (f, b) => expect(detectarFormato(b)).toBe(f));
test.each([['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')], ['gif', GIF_1PX], ['texto', Buffer.from('hola')]])('rechaza %s', (_n, b) => expect(detectarFormato(b)).toBeNull());
test('procesarLogo reduce 2000x1000 a 512x256 PNG y no agranda 100x100', async () => { /* sharp().metadata() */ });
test('Review Focus 3: imagen de 20000x20000 (bomba) → 400', async () => { /* PNG generado con sharp, comprimido < 1 MB */ });
// integración (Postgres + MinIO + NATS reales)
test('admin sube logo: 200, logoVersion 1, objeto en MinIO, GET /consultorio/logo devuelve PNG', async () => { /* ... */ });
test('reemplazar el logo borra el objeto anterior', async () => { /* listar llaves del prefijo */ });
test('Review Focus 1: dos subidas simultáneas → queda una llave, existe, logoVersion 2', async () => { /* Promise.all */ });
test('Review Focus 2: archivo .png que es SVG/HTML → 400 y nada guardado', async () => { /* ... */ });
test('archivo de 1.5 MB → 400 "El logo debe pesar menos de 1 MB"', async () => { /* ... */ });
test('Review Focus 4: el token de B nunca obtiene el logo de A', async () => { /* B sin logo → 404 */ });
test('recepción no admin → 403 en PATCH, PUT y DELETE', async () => { /* ... */ });
test('PATCH: teléfono normalizado a E.164; color amarillo pálido → 400; sin cambios → no emite evento', async () => { /* ... */ });
test('PATCH emite consultorio.actualizado solo con los campos que cambiaron', async () => { /* ... */ });
test('almacenamiento caído: GET /consultorio 200; GET /consultorio/logo 503', async () => { /* minio.stop() */ });
// gateway
test('el gateway acepta 1.5 MB en PUT /api/identidad/consultorio/logo y rechaza >1 MB en otras rutas', async () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm turbo run test --filter=@consultorio/contracts --filter=@consultorio/svc-identidad --filter=@consultorio/gateway` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Mismo comando, luego `docker compose --profile app up -d --build --wait` (identidad sano, lo que prueba que `sharp` carga en la imagen) y `pnpm --filter @consultorio/e2e test` — Expected: todo PASS.
- [ ] **Step 5: Commit** `feat(identidad): personalización del consultorio y logo en el almacenamiento`.

---

### Task 4: Sitio web · Mi consultorio, tema y encabezado

**Files:**
- Create: `apps/web/src/features/consultorio/{api.ts,actions.ts,logica/{tema,formulario}.ts,components/{FormularioPersonalizacion,SeccionLogo,VistaPreviaEncabezado,SelectorColor}.tsx}`, `apps/web/src/app/(app)/consultorio/page.tsx`, `apps/web/src/app/consultorio/logo/route.ts`
- Modify: `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/features/navegacion/**`, `apps/web/src/features/sesion/{actions.ts,logica/validaciones.ts,components/formulario-registro.tsx}`, `apps/web/src/features/bitacora/logica/acciones.ts`, `apps/web/src/lib/api/gateway.ts` (cuerpo binario)
- Test: `apps/web/test/unit/features/consultorio/**`, `apps/web/test/unit/features/sesion/**`, `apps/web/test/unit/features/bitacora/**`, `apps/web/test/unit/app/logo-route.test.ts`

**Interfaces:**
- Consumes: Tasks 1 y 3 (`consultorioSchema`, `personalizacionSchema`, reglas de país y color, rutas de identidad).
- Produces:
  - `llamarGateway` acepta `cuerpoBinario?: { bytes: Uint8Array; tipo: string }` (se envía crudo con su `Content-Type`) y `respuestaBinaria?: true` (devuelve `{ bytes, tipo, cabeceras }`).
  - `variablesDeTema(c: Consultorio): Record<string, string>` → `{ '--primary': c.colorPrimario, '--primary-foreground': c.colorTexto }` o `{}` si no hay color. El layout de `(app)` las pone en el `style` del contenedor raíz.
  - `PALETA: readonly string[]`: 8 colores, todos con `colorValidoSobreBlanco === true`.
  - Acciones: `guardarPersonalizacion(prev, formData): EstadoFormulario` (envía solo los campos modificados; vacío → `null`), `subirLogo(prev, formData)` (lee el `File`, valida en el cliente tamaño y tipo con los mismos textos, lo envía crudo), `quitarLogo()`. Todas `revalidatePath('/', 'layout')`.
  - Ruta `GET /consultorio/logo` (route handler de Next): exige sesión; pide `GET /api/identidad/consultorio/logo` con el token del usuario; 200 → reenvía bytes y `Cache-Control: private, max-age=86400`; 404 → 404; otro → 503. Ignora parámetros de consulta (el `?v=` solo rompe caché).
  - Encabezado: `<img src="/consultorio/logo?v={logoVersion}" alt="Logo de {nombre}">` solo si `logoVersion > 0`; si la imagen falla al cargar (`onError`), se oculta y queda el nombre. Nombre mostrado: `nombreComercial ?? nombre`.
  - Página `/consultorio`: solo admin (si no → `/sin-acceso`); formulario con vista previa en vivo, `SelectorColor` (paleta + `<input type="color">`, con el aviso "Elige un color más oscuro" si no pasa la regla), `SeccionLogo` (vista previa, "Cambiar", "Quitar"). Menú: "Mi consultorio" solo para admin.
  - Registro: selector de país con "México" (valor `MX`) y "Bolivia (próximamente)" deshabilitado; se envía `pais`.
  - Bitácora: `etiquetaAccion('consultorio.actualizado') = 'Consultorio actualizado'` y el detalle muestra los campos en español (Logo, Color, Nombre comercial, Dirección, Teléfono).

- [ ] **Step 1: Escribir las pruebas que fallan**

```tsx
test('variablesDeTema con color y sin color', () => { /* ... */ });
test('toda la PALETA pasa colorValidoSobreBlanco', () => expect(PALETA.every(colorValidoSobreBlanco)).toBe(true));
test('guardarPersonalizacion envía solo lo modificado y vacío como null', async () => { /* ... */ });
test('subirLogo: archivo de 1.5 MB → "El logo debe pesar menos de 1 MB" sin llamar al gateway', async () => { /* ... */ });
test('SelectorColor: amarillo pálido muestra "Elige un color más oscuro" y deshabilita guardar', async () => { /* ... */ });
test('Review Focus 4: la ruta del logo usa el token de la sesión e ignora parámetros', async () => { /* ?tenant=otro no cambia la llamada */ });
test('ruta del logo: 404 → 404; 503 → 503; sin sesión → redirect /login', async () => { /* ... */ });
test('Review Focus 5: logo quitado (logoVersion>0 pero 404) → la imagen se oculta y queda el nombre', async () => { /* fireEvent.error */ });
test('página /consultorio sin admin → /sin-acceso', async () => { /* ... */ });
test('registro envía pais MX y muestra Bolivia deshabilitado', async () => { /* ... */ });
test('bitácora: consultorio.actualizado → "Consultorio actualizado" con campos en español', () => { /* ... */ });
```

- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/web test` — Expected: FAIL.
- [ ] **Step 3: Implementar** según Interfaces.
- [ ] **Step 4: Ejecutar y ver pasar.** Run: `pnpm --filter @consultorio/web typecheck lint test build` — Expected: PASS con cobertura ≥ 80%.
- [ ] **Step 5: Commit** `feat(web): mi consultorio, tema con el color del consultorio y logo en el encabezado`.

---

### Task 5: E2E, infraestructura (solo código) y documentación

**Files:**
- Create: `tests/e2e/test/personalizacion.e2e.test.ts`, `tests/e2e-web/test/personalizacion.spec.ts`, `tests/e2e-web/test/fixtures/logo.png` (imagen de prueba pequeña generada para el repo)
- Modify: `infra/lib/servicios.ts`, `infra/test/infra.test.ts`, `README.md`
- Test: los propios E2E e `infra/test/infra.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - E2E de API: el admin personaliza (teléfono con espacios → guardado E.164), sube el logo por el gateway, lo lee, lo reemplaza y lo quita; la bitácora muestra `consultorio.actualizado`; recepción recibe 403.
  - E2E de navegador: el admin entra a "Mi consultorio", elige un color de la paleta y sube `logo.png` → el encabezado muestra el logo y un botón primario tiene ese color de fondo (`getComputedStyle`); una recepcionista no ve "Mi consultorio" en el menú y `/consultorio` la lleva a `/sin-acceso`.
  - Infra: la tarea de identidad recibe `S3_BUCKET` (bucket `Archivos` existente) y `S3_REGION`, y su rol obtiene `s3:GetObject`, `s3:PutObject` y `s3:DeleteObject` solo sobre `logos/*` (prueba de CDK que lo comprueba). Prohibido `cdk deploy`/`bootstrap`/`aws`.
  - README: la sección "Mi consultorio", las variables S3 nuevas y que el logo se guarda en MinIO en local.

- [ ] **Step 1: Escribir los E2E y la prueba de infra que fallan.**
- [ ] **Step 2: Ejecutar y ver fallar.** Run: `pnpm --filter @consultorio/infra test` — Expected: FAIL en la nueva.
- [ ] **Step 3: Implementar** infra y README.
- [ ] **Step 4: Verificación completa.** Run: `pnpm turbo run typecheck lint test --filter='!@consultorio/e2e' --filter='!@consultorio/e2e-web' && docker compose --profile app down -v && docker compose --profile app up -d --build --wait && pnpm --filter @consultorio/e2e test && pnpm --filter @consultorio/e2e-web test` — Expected: todo PASS.
- [ ] **Step 5: Commit** `test(e2e): personalización del consultorio; infra y docs`.

---

## Criterio de terminado

- Los 5 criterios de éxito de la spec §1 se cumplen y se ven en `http://localhost:3000`.
- Typecheck, lint y pruebas en verde con cobertura ≥ 80% por paquete; E2E de API y de navegador en verde.
- Revisión de cada tarea y revisión final sin hallazgos importantes abiertos.
- Costo $0.
