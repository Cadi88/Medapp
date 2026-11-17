# Pendientes diferidos — Fase 1 · Entrega 3 (recordatorios y "Mi día")

Hallazgos menores de las revisiones que se dejaron para después (ninguno bloquea la integración). Fuente: ledger de ejecución, 2026-11-16.

## De la revisión final y su ola de correcciones
- **"Pide cambio" en una cita ya confirmada:** si el paciente pide cambio sobre una cita `confirmada`, la marca solo se quita reprogramando (confirmar otra vez es una transición inválida y un "Confirmó" de recepción se ignora). Arreglo sugerido: en `decidirRespuesta`, `confirma` sobre una confirmada con `pideCambio` limpia la marca y emite `estado_cambiado` con `pideCambio: false`.
- **`no_intentado` mezcla dos casos:** "aún no toca enviar" y "tocaba pero agenda/identidad fallaron". En el segundo, "Reintentar"/"Enviar ahora" no muestran aviso (la fila queda `aprobado`).
- **Zona horaria con dos fuentes:** `enviableAhora` del listado usa la zona de identidad y la decisión de envío la tabla local `consultorio` (que nunca se actualiza). Solo importa si algún día se puede cambiar la zona del consultorio.
- **Corrida que cruza la medianoche:** un reintento de la corrida (fallo transitorio u `ocupado`) que pasa al día local siguiente hace que el lote del día anterior no se corra solo. Riesgo con horas de envío cercanas a las 00:00.
- **Ventana de duplicado:** si el proceso se cae entre el envío SMTP y `marcarEnviado`, al vencer el reclamo (5 min) el programador reenvía; además el enlace del primer correo muestra "Este enlace ya no es válido" porque el envío nunca quedó `enviado`.
- **Una cita cancelada por el paciente desaparece de "Recordatorios"** (el interno de agenda solo devuelve agendada/confirmada); se ve en agenda y bitácora.
- **Primer `PUT /config` sin fila:** dos guardados simultáneos en un consultorio nuevo pueden pisarse (`FOR UPDATE` no bloquea nada si no hay fila). Arreglo: `INSERT … ON CONFLICT DO NOTHING` antes de la lectura bloqueada.
- **Log "rewrite url" del gateway en nivel debug** puede registrar un token sin enmascarar en URLs malformadas.
- **Pestaña en blanco de WhatsApp** puede quedar abierta si la sesión expiró justo al hacer clic (la acción redirige a login).

## Menores por tarea
- **Task 1:** generar-dev-env escribe dos veces el encabezado "Agregado por…"; la validación de fechas del interno de agenda ocurre después de leer la zona (404 en vez de 400 sin consultorio); zona inválida reportada como "Fecha inválida"; `details` siempre en `hasta`.
- **Task 2:** ramas de conflicto de versión en el consumidor de agenda sin prueba; switch sin default (zod lo cubre); nombre de prueba confuso.
- **Task 3:** deps pino/zod sin uso y uuidv7 en dependencies de svc-notificaciones; longitud de plantillas en UTF-16 vs code points; sin CHECK `enviado` ↔ `enviado_en`.
- **Task 4:** `asegurarEnvios` puede revivir una fila de una cita recién cancelada (no se envía porque agenda filtra, pero queda fila pendiente); el resultado reporta `anulado` también cuando el reclamo expiró y otro lo tomó; prueba de guarda de estado no aislada; limpieza de dobles de logo en pruebas.
- **Task 5:** 1+N llamadas a agenda por corrida y un solo candado global que serializa consultorios (pasar las citas ya leídas a `enviarCorreo`); sin prueba del warn de espera vencida ni del cableado del filtro en el handler.
- **Task 6:** "Aprobar todos" envía en serie dentro de la petición (posible 503 del gateway con SMTP real y ~20 citas; §4.2 pide datos del consultorio y logo una vez por lote); "Aprobar todos" solo envía los recién aprobados.
- **Task 7:** "Mi día" abierto pasada la medianoche muestra el día anterior hasta recargar.
- **Task 8:** la prueba de "documentada" de `notificaciones_db` busca un comentario; condición `kms:ViaService` opcional en el rol de notificaciones; aviso de turbo "no output files" en `infra#test`; ventana residual si la prueba de navegador dura más de ~50 min desde las 22:59 CDMX; `ORIGEN_WEB` sale de `E2E_WEB_URL` y el correo de `WEB_ORIGEN`.
- **Previos (no de esta entrega):** pruebas de navegador inestables por los límites por IP de Better Auth cuando las suites e2e corren en paralelo (`agenda.spec › zona horaria`, `permisos.spec › un segundo médico` pasaron al reintento).
