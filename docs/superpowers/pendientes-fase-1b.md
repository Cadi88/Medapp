# Pendientes diferidos — Fase 1 · Entrega 2 (personalización)

Hallazgos menores de las revisiones que se dejaron para después (ninguno bloquea la integración). Fuente: ledger de ejecución, 2026-11-12.

## De la revisión final
- El layout compartido no se vuelve a renderizar en navegación suave: otros miembros ven un logo/color nuevo al recargar o volver a entrar.
- El gateway acumula hasta 2 MB en la ruta del logo antes de rechazar una petición sin token.
- La prueba del cliente S3 lee un campo interno de NodeHttpHandler (frágil ante actualizaciones de @smithy).

## Menores por tarea
- **Task 1:** registro calcula reglasDe(pais).moneda dos veces (evento e INSERT); pruebas de texto SQL de 005 redundantes
- **Task 2:** S3_ENDPOINT vacío ("") hace fallar la config — preprocesar "" a undefined; no registrar el objeto de config completo (trae el secreto)
- **Task 2:** respuesta sin Body devuelve bytes vacíos; `?? ''` en credenciales; unit de crearAlmacenS3 casi vacía
- **Task 3:** re-chequeo de admin ocurre después de procesar/guardar (desperdicio, resultado correcto); objetos huérfanos sin barrido posterior
- **Task 3:** un cuerpo application/json en la ruta del logo también recibe "Sube una imagen…"
- **Task 4:** content-type fijo image/png en la ruta (sin comentario); detalleDeAccion se calcula dos veces por fila
- **Task 4:** BarraDeNavegacion con consultorioId opcional ('' por omisión) podría reabrir la caché compartida si un llamador lo olvida → hacerlo obligatorio
- **Task 5:** aserciones de infra (KMS/S3) no atadas al rol de identidad ni al ARN de la llave
