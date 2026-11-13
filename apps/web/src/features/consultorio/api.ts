import 'server-only';
import { consultorioSchema } from '@consultorio/contracts';
import { headers } from 'next/headers';
import { ipDelCliente, llamarGateway, type RespuestaBinaria } from '@/lib/api/gateway';
import type { Resultado } from '@/lib/api/resultado';
import type { CambiosPersonalizacion } from './logica/formulario';

const CONSULTORIO = '/api/identidad/consultorio';
const LOGO = `${CONSULTORIO}/logo`;

async function ipActual(): Promise<string | undefined> {
  return ipDelCliente(await headers());
}

export const obtenerConsultorioEnApi = async () =>
  llamarGateway(CONSULTORIO, { auth: 'token', esquema: consultorioSchema, ip: await ipActual() });

export const personalizarEnApi = async (cuerpo: CambiosPersonalizacion) =>
  llamarGateway(`${CONSULTORIO}/personalizacion`, {
    metodo: 'PATCH',
    cuerpo,
    auth: 'token',
    esquema: consultorioSchema,
    ip: await ipActual(),
  });

export const subirLogoEnApi = async (bytes: Uint8Array, tipo: string) =>
  llamarGateway(LOGO, { metodo: 'PUT', cuerpoBinario: { bytes, tipo }, auth: 'token', ip: await ipActual() });

export const quitarLogoEnApi = async () => llamarGateway(LOGO, { metodo: 'DELETE', auth: 'token', ip: await ipActual() });

export async function obtenerLogoEnApi(): Promise<Resultado<RespuestaBinaria>> {
  return llamarGateway<RespuestaBinaria>(LOGO, { auth: 'token', respuestaBinaria: true, ip: await ipActual() });
}
