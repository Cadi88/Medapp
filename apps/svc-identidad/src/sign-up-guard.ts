const ALTA_RE = /(^|\/)sign-up(\/|$)/i;

/**
 * true si es una llamada HTTP (con `request`) a un endpoint `/sign-up/*` de Better Auth.
 * Las cuentas solo se crean vía `/registro` (o invitaciones), que usan `auth.api.signUpEmail`
 * del lado servidor, sin `request`; por eso esas llamadas internas no se bloquean.
 */
export function esAltaDirecta(ruta: string, conRequest: boolean): boolean {
  if (!conRequest) return false;
  const i = ruta.search(/[?#]/);
  return ALTA_RE.test(i === -1 ? ruta : ruta.slice(0, i));
}
