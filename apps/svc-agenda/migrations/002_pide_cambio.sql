-- svc-agenda: marca de "el paciente pidió cambiar la cita" (Fase 1 entrega 3, spec §4.7).
-- Se enciende al responder el recordatorio y se apaga al reprogramar. No cambia permisos: agenda_app ya tiene UPDATE sobre cita.

ALTER TABLE cita ADD COLUMN pide_cambio boolean NOT NULL DEFAULT false;
