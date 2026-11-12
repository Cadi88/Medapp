# Pendientes diferidos — Fase 1 · Entrega 1

Hallazgos menores de las revisiones por tarea y de la revisión final que se dejaron para después (ninguno bloquea la integración). Fuente: ledger de ejecución, 2026-11-12.

## Diferidos con decisión (rulings)
- limitesDelCalendario usa minutos transcurridos para el fin: en día de cambio a horario de verano (p. ej. Tijuana) una cita que termina a las 22:00 puede quedar cortada — Ruling R19: se difiere a la siguiente entrega (CDMX no tiene DST; afecta solo zonas fronterizas un día al año) — costo: una cita tardía invisible en escritorio ese día
- PATCH de cita de médico inactivo dentro de su propia agenda muestra "La cita ya no existe" (404 del médico destino) — Ruling R20: mensaje más específico en la siguiente entrega; el comportamiento (exigir médico activo como destino) es el de la spec — costo: texto confuso
- Ruling R18: la ola única de arreglos incluye los 5 Important y los minors 6–10 de final-findings.md; se dejan diferidos: el médico no editable al reprogramar, el esquema de bitácora en contracts, y el resto de minors ya triados como aceptables — costo: si alguno diferido importa, queda en la lista para la siguiente entrega

## Menores por tarea
- **Task 1:** eslint dominio messages mention src/datos/src/rutas (identidad usa src/routes) — correcto para svc-agenda nuevo
- **Task 1:** regla ESLint de dominio sin prueba comprometida
- **Task 1:** registro.ts calcula rolFundador dos veces (evento e INSERT)
- **Task 1:** DELETE /miembros usa throw inline en vez de exigirActorVigente
- **Task 1:** TDD RED solo observado en require-admin.test.ts
- **Task 2:** reinicio sin cuenta credential (404) sin prueba
- **Task 2:** carrera vínculo a otro consultorio en paralelo al reinicio no bloqueada (FOR SHARE solo de este tenant)
- **Task 2:** bajar la bandera en hooks.after no es atómico con el cambio de contraseña
- **Task 2:** TDD RED solo en unitarias
- **Task 3:** secuencia bloqueo-admins + actor-admin duplicada entre PATCH y DELETE (helper bloquearAdmins)
- **Task 3:** PATCH sin cambios igual emite miembro.actualizado
- **Task 3:** prueba de orden usa localeCompare vs collation de PG
- **Task 3:** z.string().uuid() deprecado en Zod 4 (usar z.uuid())
- **Task 4:** prueba 'siguiente es null' depende del conteo del tenant compartido A (frágil)
- **Task 4:** sin prueba de página final exacta (siguiente no nulo + página vacía)
- **Task 5:** FK de cita no ata tipo_cita al mismo médico (Task 8 valida en código)
- **Task 5:** rangos infinitos permitidos en cita/bloqueo (validación Zod en Tasks 7-8 los impide)
- **Task 5:** EventoMedico con rol/nombre opcionales (unión discriminada)
- **Task 5:** mapeo del consumidor sin prueba unitaria; prueba de reentrega no aísla el inbox
- **Task 6:** prueba de hora ambigua no fija los instantes exactos
- **Task 6:** rangoDeCita acepta ISO sin offset (depende de la zona del host) — Tasks 7-8 validan con z.iso.datetime({offset:true})
- **Task 6:** huecosLibres acepta fecha con hora; sin dedupe de bloques duplicados (validarSemana lo evita)
- **Task 6:** cita en la segunda ocurrencia de una hora ambigua (01:00 PST en fall-back) se rechaza si el bloque empieza a la 01:00 — conservador a propósito
- **Task 7:** validación de cuerpo antes de exigirGestion (400 en vez de 403/404, sin fuga)
- **Task 7:** rama 23P01→400 de PUT horario sin prueba (inalcanzable vía API)
- **Task 7:** prueba de rollback de horario duplicada; cast bloques as BloqueHorario[]; nombreTipo acepta solo espacios (falta trim); disponibilidad sin caso DST
- **Task 8:** events/agenda.ts usa z.string().datetime()/uuid() y redeclara el enum de estado (reusar estadoCitaSchema)
- **Task 8:** comentario de listarCitas dice "por inicio" pero filtra por traslape
- **Task 8:** carrera bloqueo vs cita no documentada (aceptable; advisory lock si se vuelve invariante)
- **Task 8:** fueraDeHorario guarda si realmente está fuera; reprogramar exige tipo activo; GET /citas/:id ajena → 403 (coherente con spec §3.3)
- **Task 9:** E2E de agenda no comprueba ausencia de contacto en eventos (cubierto en svc-agenda T8)
- **Task 10:** matcher del proxy omite rutas con punto
- **Task 10:** README nota de red de producción no menciona agenda/web
- **Task 10:** confianza en XFF depende de que el proxy de borde la agregue (documentado, no forzado)
- **Task 11:** reglas de formulario copiadas de identidad (slug, password) en vez de compartidas en contracts
- **Task 11:** sin aviso si el auto-login tras registro falla; errores VALIDACION del servidor pierden el campo
- **Task 11:** validaciones.test.ts sin RED
- **Task 12:** clic en hueco vacío solo precarga la fecha; una falla de tipos de un médico tumba la página; VALIDACION del servidor no se mapea a campos; "hoy" con new Date() en useState (hidratación a medianoche)
- **Task 13:** funciones duplicadas (textoLocal/formatearFechaEvento, primero, ipActual); filtro hasta descartado en silencio; aria-describedby en edición de tipos; sin guard de página en /medicos/[id] (el servicio da 403); equipo sin RED; cambio de password en /perfil redirige a /agenda
- **Task 13:** en un segundo envío de alta la contraseña anterior reaparece brevemente mientras la petición está pendiente
- **Task 14:** espera fija de 11 s por rate limit de Better Auth en apoyo.ts; prueba de costo grepea el texto de bin/app.ts; lista exhaustiva de secretos sin agenda_*; README dice ~200 USD vs ~235 en bin/app.ts; ramas de claveManual sin prueba
