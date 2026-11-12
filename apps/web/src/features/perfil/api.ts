import 'server-only';
import { headers } from 'next/headers';
import { ipDelCliente, llamarGateway } from '@/lib/api/gateway';

export const guardarPerfilMedicoEnApi = async (medicoId: string, cuerpo: unknown) =>
  llamarGateway(`/api/identidad/medicos/${encodeURIComponent(medicoId)}/perfil`, {
    metodo: 'PUT',
    cuerpo,
    auth: 'token',
    ip: ipDelCliente(await headers()),
  });
