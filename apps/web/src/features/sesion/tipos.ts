/** Estado que devuelven las server actions a `useActionState`. `errores`: mensaje por nombre de campo. */
export interface EstadoFormulario {
  ok?: true;
  errores?: Record<string, string>;
  /** Lo escrito en los campos que no son secretos, para no vaciar el formulario al fallar. */
  valores?: Record<string, string>;
  mensaje?: string;
}

/** Estado del alta del MFA: el QR (SVG generado en el servidor), la clave para teclearla a mano y los códigos de respaldo. */
export interface EstadoConfiguracionMfa extends EstadoFormulario {
  qrSvg?: string;
  codigosRespaldo?: string[];
  /** Secreto TOTP en base32, para quien no puede escanear el QR. */
  claveManual?: string;
}

export interface ConsultorioDelUsuario {
  tenantId: string;
  nombre: string;
  slug: string;
  rol: 'medico' | 'recepcion';
  admin: boolean;
}
