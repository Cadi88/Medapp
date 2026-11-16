export interface AdjuntoEnLinea {
  /** Content-ID: el HTML lo referencia como `cid:<cid>`. */
  cid: string;
  contenido: Uint8Array;
  tipo: string;
}

export interface MensajeCorreo {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  adjuntos?: AdjuntoEnLinea[];
}

/** Canal de correo (SMTP en producción, Mailpit en local). Lanza si no se pudo enviar. */
export interface CanalCorreo {
  enviar(mensaje: MensajeCorreo): Promise<void>;
}
