/** Resultado de una acción de la pantalla Recordatorios; `mensaje` ya viene en español y listo para mostrar. */
export type ResultadoRecordatorio = { ok: true } | { mensaje: string };

/** "Abrir WhatsApp": además de registrarse, entrega el enlace que el navegador debe abrir. */
export type ResultadoWhatsApp = { ok: true; enlace: string } | { mensaje: string };
