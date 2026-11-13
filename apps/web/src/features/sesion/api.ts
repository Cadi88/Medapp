import 'server-only';
import type { CodigoPais } from '@consultorio/contracts';
import { z } from 'zod';
import { llamarGateway } from '@/lib/api/gateway';
import type { Resultado } from '@/lib/api/resultado';
import type { ConsultorioDelUsuario } from './tipos';

/** Llamadas de identidad que usa el flujo de entrada. Better Auth responde con sus propios formatos: se validan aquí. */
const AUTH = '/api/identidad/auth';

const consultoriosSchema = z.array(
  z.object({
    tenantId: z.string(),
    nombre: z.string(),
    slug: z.string(),
    rol: z.enum(['medico', 'recepcion']),
    admin: z.boolean(),
  }),
);
const tokenSchema = z.object({ token: z.string().min(1) });
const habilitarMfaSchema = z.object({ totpURI: z.string().min(1), backupCodes: z.array(z.string()) });
const inicioSesionSchema = z.object({ twoFactorRedirect: z.boolean().optional() });

export interface DatosRegistro {
  nombreConsultorio: string;
  slug: string;
  zonaHoraria: string;
  pais: CodigoPais;
  esMedico: boolean;
  admin: { nombre: string; email: string; password: string };
}

const conIp = (ip?: string) => (ip ? { ip } : {});

export const registrar = (cuerpo: DatosRegistro, ip?: string) =>
  llamarGateway('/api/identidad/registro', { metodo: 'POST', cuerpo, auth: 'ninguna', ...conIp(ip) });

/** Sin cookies de la petición: un inicio de sesión nuevo no debe arrastrar una sesión anterior. */
export const iniciarSesionConCorreo = (
  email: string,
  password: string,
  ip?: string,
): Promise<Resultado<{ twoFactorRedirect?: boolean }>> =>
  llamarGateway(`${AUTH}/sign-in/email`, {
    metodo: 'POST',
    cuerpo: { email, password },
    auth: 'ninguna',
    esquema: inicioSesionSchema,
    ...conIp(ip),
  });

export const verificarCodigoTotp = (code: string, ip?: string) =>
  llamarGateway(`${AUTH}/two-factor/verify-totp`, { metodo: 'POST', cuerpo: { code }, auth: 'sesion', ...conIp(ip) });

export const habilitarMfa = (password: string, ip?: string) =>
  llamarGateway(`${AUTH}/two-factor/enable`, {
    metodo: 'POST',
    cuerpo: { password },
    auth: 'sesion',
    esquema: habilitarMfaSchema,
    ...conIp(ip),
  });

export const cambiarPasswordEnApi = (currentPassword: string, newPassword: string, ip?: string) =>
  llamarGateway(`${AUTH}/change-password`, {
    metodo: 'POST',
    cuerpo: { currentPassword, newPassword, revokeOtherSessions: true },
    auth: 'sesion',
    ...conIp(ip),
  });

export const cerrarSesionEnApi = (ip?: string) =>
  llamarGateway(`${AUTH}/sign-out`, { metodo: 'POST', auth: 'sesion', ...conIp(ip) });

export const consultoriosDelUsuario = (ip?: string): Promise<Resultado<ConsultorioDelUsuario[]>> =>
  llamarGateway('/api/identidad/tenants/mios', { auth: 'sesion', esquema: consultoriosSchema, ...conIp(ip) });

export const tokenDelConsultorio = (tenantId: string, ip?: string) =>
  llamarGateway('/api/identidad/sesion/tenant', {
    metodo: 'POST',
    cuerpo: { tenantId },
    auth: 'sesion',
    esquema: tokenSchema,
    ...conIp(ip),
  });
