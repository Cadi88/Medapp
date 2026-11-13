# Fase 1 · Entrega 2 — Personalización del consultorio

**Fecha:** 2026-11-12
**Estado:** borrador para revisión
**Base:** [Diseño general](2026-11-10-saas-consultorios-design.md) (§1.6, §2.2, §3.2, §3.9) y la [entrega 1](2026-11-11-fase-1a-web-agenda-design.md), ya integrada en `main`.

---

## 1. Intención

La app es de uso privado de cada consultorio (no hay páginas para pacientes). El dueño quiere que cada consultorio sienta la app como **suya**: su logo, su color y sus datos de contacto. Es también un argumento de venta cuando se ofrece el software en persona. Los mismos datos aparecerán en los documentos que el paciente se lleva (recetas en la Fase 2, facturas en la Fase 3).

Esta entrega también agrega **país y moneda** al consultorio, pendientes del diseño multipaís (§3.9 de la spec general), porque toca la misma tabla y el mismo servicio.

**Criterios de éxito:**
1. El administrador sube un logo, elige un color y captura nombre comercial, dirección y teléfono desde la app.
2. Al entrar, todo el equipo del consultorio ve el logo en el encabezado y el color en botones y menú.
3. Ningún color elegido deja texto ilegible.
4. Un archivo malicioso (SVG con código, archivo que dice ser imagen y no lo es, archivo enorme) nunca se guarda ni se sirve.
5. Costo $0: todo corre local (MinIO en Docker).

## 2. Objetivos, no objetivos y anti-objetivos

- **Objetivos:** logo, color principal, nombre comercial, dirección y teléfono por consultorio; país y moneda en el consultorio; almacenamiento de archivos reutilizable por la Fase 2 (radiografías, estudios).
- **No objetivos:** personalizar la pantalla de login (es común a todos: la app aún no sabe el consultorio); dominios o direcciones propias por consultorio; tipografías; varios colores o temas completos; modo oscuro personalizado; habilitar Bolivia (eso es la Fase 4).
- **Anti-objetivos:** que el almacenamiento de archivos quede expuesto a internet; que una imagen subida pueda ejecutar código en el navegador; que un consultorio vea o cambie la personalización de otro.

## 3. Enfoques considerados

| Enfoque | A favor | En contra |
|---|---|---|
| **A. Logo en almacenamiento de archivos (MinIO local, S3 en producción), servido a través de Next** — **elegido** | El almacenamiento nunca es público; es la misma pieza que necesita la Fase 2 para adjuntos | Agrega un componente de almacenamiento a la plataforma |
| B. Logo dentro de la base de datos | Lo más simple hoy | Camino aparte que no sirve para radiografías; habría que rehacerlo en la Fase 2 |
| C. Solo color y datos, sin logo | Lo más rápido | El logo es lo que más se nota en la receta impresa |

El dueño eligió **A** (2026-11-12).

## 4. Diseño

### 4.1 Datos (svc-identidad, migración `005_personalizacion.sql`)
Columnas nuevas en `tenant` (tabla global; el acceso se filtra por el `tid` del token):

| Columna | Tipo y reglas |
|---|---|
| `nombre_comercial` | `text NULL`, 2–120 caracteres. Si es nulo se muestra `nombre` |
| `direccion` | `text NULL`, hasta 300 caracteres |
| `telefono` | `text NULL`, guardado siempre en E.164 (`+52…`, `+591…`). El servidor normaliza la entrada con las reglas del país (acepta dígitos nacionales, espacios, guiones o el formato antiguo `+521` de México) |
| `color_primario` | `text NULL`, `CHECK (color_primario ~ '^#[0-9a-f]{6}$')` (minúsculas). Nulo = color por omisión de la app |
| `logo_key` | `text NULL`, llave del objeto en el almacenamiento |
| `logo_version` | `integer NOT NULL DEFAULT 0`, se incrementa en cada cambio de logo (sirve para invalidar caché) |
| `pais` | `text NOT NULL DEFAULT 'MX'`, `CHECK (pais IN ('MX','BO'))` |
| `moneda` | `text NOT NULL DEFAULT 'MXN'`, `CHECK (moneda IN ('MXN','BOB'))` |

Los consultorios existentes quedan como `MX`/`MXN` por el valor por omisión.

### 4.2 Reglas por país (`packages/contracts/src/paises/`)
Se crea el módulo de reglas de §3.9 con lo mínimo que esta entrega usa:
- `ReglasPais = { codigo: 'MX' | 'BO'; moneda; prefijoTelefonico; telefonoSchema; zonasHorarias }`.
- `mx.ts` (prefijo `+52`, teléfono de 10 dígitos nacionales) y `bo.ts` (prefijo `+591`, 8 dígitos nacionales), y `reglasDe(pais)`.
- `PAISES_HABILITADOS = ['MX']`: el registro solo acepta los habilitados.

### 4.3 Almacenamiento de archivos (`packages/platform`)
- Interfaz `Almacen { guardar(llave, bytes, tipo): Promise<void>; leer(llave): Promise<{ bytes, tipo } | null>; borrar(llave): Promise<void> }`.
- Implementación S3 con `@aws-sdk/client-s3` (`forcePathStyle: true` para MinIO). Configuración por variables: `S3_ENDPOINT` (solo local), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (solo local; en AWS se usa el rol de la tarea).
- Al arrancar, si el bucket no existe **y** hay `S3_ENDPOINT` (entorno local), se crea. En AWS el bucket lo crea la infraestructura.
- Ayudante de pruebas `startMinio()` en `@consultorio/platform/testing` (Testcontainers con la misma imagen que compose).
- Llaves por consultorio: `logos/{tenantId}/{uuidv7}.png` (§4.4). La Fase 2 seguirá el mismo patrón (`adjuntos/{tenantId}/…`).

### 4.4 Procesamiento del logo (reglas puras + `sharp`)
1. Se aceptan solo **PNG, JPEG y WebP**, detectados por sus bytes iniciales (no por el nombre ni el tipo declarado). SVG, GIF y cualquier otro formato → rechazo.
2. Tamaño máximo **1 MB** del archivo recibido.
3. El servidor **vuelve a codificar** la imagen con `sharp`: la reduce para que su lado mayor no pase de 512 px (sin agrandar), elimina metadatos y la guarda como PNG. Una imagen corrupta que `sharp` no puede leer → rechazo.
4. `sharp` corre con `limitInputPixels` de 25 millones de píxeles; una imagen que lo excede (p. ej., una "bomba de descompresión") se trata como corrupta → rechazo.
5. **Reemplazo sin carreras:** la llave del objeto es `logos/{tenantId}/{uuidv7}.png` (única en cada subida). Orden: (a) se guarda el objeto nuevo; (b) en una transacción, `SELECT … FOR UPDATE` de la fila del consultorio, se lee la llave anterior, se escribe la nueva, se incrementa `logo_version` y se encola `consultorio.actualizado`; (c) después del commit se borra el objeto anterior. Dos subidas simultáneas se serializan en el paso (b): la segunda ve como "anterior" la llave de la primera y la borra. Si un borrado falla, se registra en el log y no se revierte nada (un objeto huérfano es inofensivo). Nunca se mantiene una transacción abierta durante una llamada al almacenamiento.
6. `sharp` se importa al arrancar el servicio, así que si sus binarios nativos faltan en la imagen Docker (`node:24-slim`, glibc), el contenedor no pasa el chequeo de salud y el fallo se ve de inmediato en compose.

### 4.5 Color legible (reglas puras)
La app usa fondo claro (no hay modo oscuro personalizable), y `--primary` se usa como fondo de botones y también en bordes, anillos de foco y enlaces. Por eso hay dos reglas:
1. **Texto sobre el color:** `colorDeTexto(fondoHex): '#ffffff' | '#000000'` elige el de mayor contraste WCAG (siempre ≥ 4.5:1, así que no rechaza nada; solo elige).
2. **El color sobre el fondo blanco:** `contraste(color, '#ffffff') >= 3` (mínimo WCAG para componentes de interfaz). Un color más claro, como un amarillo pálido, se rechaza: el formulario avisa "Elige un color más oscuro" y el servidor responde `400 VALIDACION`.
La paleta sugerida solo incluye colores que pasan la regla 2.

### 4.6 API de identidad (vía gateway `/api/identidad`, todas con JWT)

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /consultorio` | cualquier miembro | Agrega `nombreComercial`, `direccion`, `telefono`, `colorPrimario`, `colorTexto` (calculado), `logoVersion` (0 = sin logo), `pais`, `moneda` a la respuesta actual |
| `PATCH /consultorio/personalizacion` | admin | `{ nombreComercial?, direccion?, telefono?, colorPrimario? }`: un campo omitido no cambia; `null` lo borra (sin `nombreComercial` se muestra `nombre`) → 200 con el consultorio |
| `PUT /consultorio/logo` | admin | El archivo crudo como cuerpo (no `multipart/form-data`), con `Content-Type` `image/png`, `image/jpeg` o `image/webp` (≤ 1 MB) → 200 `{ logoVersion }` |
| `DELETE /consultorio/logo` | admin | 204 |
| `GET /consultorio/logo` | cualquier miembro | La imagen PNG del consultorio del token; 404 si no tiene logo |

- Cada cambio emite **`consultorio.actualizado` v1** `{ campos: string[] }` con los nombres de los campos que **realmente** cambiaron (comparados con la fila actual), en la misma transacción. Si nada cambió, no se escribe ni se emite nada. La bitácora lo muestra como "Consultorio actualizado" con los campos en español (Logo, Color, Nombre comercial, Dirección, Teléfono).
- **Escritura acotada:** la migración 005 da a `identidad_app` `UPDATE` solo sobre las columnas de personalización (`nombre_comercial`, `direccion`, `telefono`, `color_primario`, `logo_key`, `logo_version`); `nombre`, `slug`, `pais` y `moneda` no se pueden cambiar desde estas rutas. Toda escritura filtra `WHERE id = <tid del token>`.
- `tenant.creado` sube a **v2** con `pais` y `moneda`. Los consumidores (agenda, auditoría) aceptan v1 y v2.
- `POST /registro` acepta `pais` (opcional, por omisión `MX`, solo valores de `PAISES_HABILITADOS`); la moneda se toma de las reglas del país.
- El gateway y `svc-identidad` permiten cuerpos de hasta 2 MB solo en la ruta del logo (identidad agrega un lector de cuerpo binario para esos tipos de imagen). El límite de 1 MB del archivo se valida después de recibirlo, para responder `400` con un mensaje claro. El resto de las rutas conserva su límite actual.

### 4.7 Sitio web
- **Página `/consultorio` ("Mi consultorio"),** solo para administradores (los demás van a `/sin-acceso`): formulario de nombre comercial, dirección, teléfono (con el prefijo del país) y color (paleta de ~8 colores que pasan la regla + selector libre), vista previa en vivo del encabezado, y sección de logo con vista previa, "Cambiar" y "Quitar".
- **El logo se sirve por una ruta de Next** (`/consultorio/logo`) que pide la imagen al gateway con el token del usuario y la devuelve con `Cache-Control: private, max-age=86400`. El `<img>` usa `?v={logoVersion}`, así que un logo nuevo se ve de inmediato.
- **Tema:** el layout de la app pone `--primary` y `--primary-foreground` (variables que ya usan los componentes) con el color del consultorio, solo dentro de la app con sesión.
- **Encabezado:** logo (si hay) + nombre comercial (o nombre).
- **Menú:** "Mi consultorio" para administradores.
- **Registro:** selector de país con "México" y "Bolivia (próximamente)" deshabilitado.

### 4.8 Docker e infraestructura
- `svc-identidad` recibe las variables S3 apuntando a MinIO y depende de que MinIO esté sano. `scripts/generar-dev-env.sh` y `.env.example` agregan las credenciales locales de MinIO (las que ya usa compose).
- `infra/` (solo código, $0): el bucket `Archivos` existente se usa para logos; el rol de la tarea de identidad obtiene permiso de lectura/escritura/borrado solo bajo `logos/*`. Sin despliegue.

## 5. Errores

| Caso | Respuesta | En pantalla |
|---|---|---|
| Archivo > 1 MB | `400 VALIDACION` (`campo: logo`) | "El logo debe pesar menos de 1 MB" |
| Formato no permitido o imagen corrupta | `400 VALIDACION` | "Sube una imagen PNG, JPG o WebP" |
| Color sin contraste suficiente con el fondo | `400 VALIDACION` | "Elige un color más oscuro" |
| Teléfono inválido para el país | `400 VALIDACION` | Junto al campo |
| No admin | `403 PROHIBIDO` | `/sin-acceso` |
| Almacenamiento caído | `GET /consultorio` responde 200 normal; solo las rutas del logo responden `503` | La app sigue funcionando con el color y sin logo; en "Mi consultorio" se muestra un aviso genérico |

## 6. Pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | `colorDeTexto` y la regla de contraste; detección de formato por bytes (PNG/JPEG/WebP sí; SVG, GIF, texto con extensión .png no); reglas por país (teléfonos MX/BO); validaciones de personalización; lógica del tema en el web |
| Integración (identidad + Postgres + MinIO reales) | Subir, reemplazar (se borra el anterior), quitar y leer el logo; `logo_version` sube; un consultorio no puede leer el logo de otro; recepción no puede cambiar nada (403); archivo de 2 MB, SVG y PNG falso → 400 y nada guardado; `consultorio.actualizado` en el outbox; migración 005 sobre datos existentes (`MX`/`MXN`); `tenant.creado` v2 y consumidor de agenda aceptando v1 y v2 |
| E2E de API | Subir logo y leerlo por el gateway; personalizar y ver el cambio en `GET /consultorio` y en la bitácora |
| E2E de navegador | El admin sube logo y elige color → el encabezado los muestra; recepción no ve "Mi consultorio" |

Cobertura ≥ 80% de líneas y ramas por paquete, como siempre.

## 7. Decisiones tomadas por el diseñador (corregibles)
- Formatos PNG/JPEG/WebP; SVG excluido por seguridad. Logo re-codificado a PNG de máximo 512 px, con límite de 25 MP al decodificar.
- El color debe contrastar al menos 3:1 con el fondo blanco (si no, se rechaza); el texto encima es blanco o negro según contraste.
- La edición es parcial (PATCH): lo omitido no cambia, `null` borra; la bitácora solo registra los campos que de verdad cambiaron.
- El teléfono lo normaliza el servidor a E.164 con las reglas del país.
- Texto blanco o negro según contraste WCAG; colores sin contraste suficiente se rechazan.
- País y moneda se agregan ahora; Bolivia aparece como "próximamente".
- Si el almacenamiento falla, la app sigue funcionando sin logo.

## 8. Queda a criterio del implementador
Nombres internos de funciones y archivos (siguiendo las capas dominio/rutas/datos), la paleta exacta de colores (respetando la regla de contraste) y la distribución visual de la página "Mi consultorio".
