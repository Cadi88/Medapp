import type { NatsConnection } from '@nats-io/transport-node';
import {
  MiembroActualizado,
  TenantCreado,
  TenantCreadoV1,
  UsuarioDesvinculado,
  UsuarioVinculado,
  UsuarioVinculadoV1,
  type EventEnvelope,
} from '@consultorio/contracts';
import { consumeEvents } from '@consultorio/platform';
import type pg from 'pg';
import type { Logger } from 'pino';
import { guardarConsultorio, guardarMedico, leerMedico } from './datos/medicos.js';
import { aplicarEventoMedico, type EventoMedico } from './dominio/medicos.js';

async function aplicarMedico(tx: pg.PoolClient, tenantId: string, usuarioId: string, e: EventoMedico): Promise<void> {
  const nuevo = aplicarEventoMedico(await leerMedico(tx, tenantId, usuarioId), e);
  if (nuevo) await guardarMedico(tx, tenantId, usuarioId, nuevo);
}

/** Traduce un evento de identidad a la copia local (consultorio y médicos). Toda escritura es un upsert idempotente. */
export async function manejarEvento(e: EventEnvelope, tx: pg.PoolClient): Promise<void> {
  switch (`${e.type}@${e.version}`) {
    case 'tenant.creado@1': {
      // La zona horaria es lo único que usa agenda: v1 y v2 solo difieren en país y moneda.
      const { data } = TenantCreadoV1.parse(e);
      await guardarConsultorio(tx, e.tenant_id, data.zonaHoraria);
      return;
    }
    case 'tenant.creado@2': {
      const { data } = TenantCreado.parse(e);
      await guardarConsultorio(tx, e.tenant_id, data.zonaHoraria);
      return;
    }
    case 'usuario.vinculado@1': {
      // v1: el rol 'admin' era un rol de trabajo equivalente a médico; el nombre llega con `miembro.actualizado`.
      const { data } = UsuarioVinculadoV1.parse(e);
      await aplicarMedico(tx, e.tenant_id, data.usuarioId, { tipo: 'vinculado', rol: data.rol === 'recepcion' ? 'recepcion' : 'medico' });
      return;
    }
    case 'usuario.vinculado@2': {
      const { data } = UsuarioVinculado.parse(e);
      await aplicarMedico(tx, e.tenant_id, data.usuarioId, { tipo: 'vinculado', rol: data.rol, nombre: data.nombre });
      return;
    }
    case 'miembro.actualizado@1': {
      const { data } = MiembroActualizado.parse(e);
      await aplicarMedico(tx, e.tenant_id, data.usuarioId, { tipo: 'actualizado', rol: data.rol, nombre: data.nombre });
      return;
    }
    case 'usuario.desvinculado@1': {
      const { data } = UsuarioDesvinculado.parse(e);
      await aplicarMedico(tx, e.tenant_id, data.usuarioId, { tipo: 'desvinculado' });
      return;
    }
    default:
      throw new Error(`evento no soportado: ${e.type} v${e.version}`);
  }
}

/** Consumidor durable `agenda`: mantiene la copia local de consultorio y médicos. */
export function iniciarConsumidor(o: { pool: pg.Pool; nc: NatsConnection; logger?: Logger }): Promise<{ stop(): Promise<void> }> {
  return consumeEvents({
    pool: o.pool,
    nc: o.nc,
    consumidor: 'agenda',
    subjects: ['evt.tenant.creado', 'evt.usuario.vinculado', 'evt.miembro.actualizado', 'evt.usuario.desvinculado'],
    handler: (e, tx) => manejarEvento(e, tx),
    ...(o.logger ? { logger: o.logger } : {}),
  });
}
