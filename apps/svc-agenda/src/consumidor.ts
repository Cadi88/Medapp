import type { NatsConnection } from '@nats-io/transport-node';
import {
  CitaCancelada,
  CitaEstadoCambiado,
  CitaRespuestaPaciente,
  MiembroActualizado,
  TenantCreado,
  TenantCreadoV1,
  UsuarioDesvinculado,
  UsuarioVinculado,
  UsuarioVinculadoV1,
  type EventEnvelope,
} from '@consultorio/contracts';
import { consumeEvents, enqueueEvent } from '@consultorio/platform';
import type pg from 'pg';
import type { Logger } from 'pino';
import { cambiarEstadoCita, leerCita, marcarPideCambio } from './datos/citas.js';
import { guardarConsultorio, guardarMedico, leerMedico } from './datos/medicos.js';
import { aplicarEventoMedico, type EventoMedico } from './dominio/medicos.js';
import { decidirRespuesta } from './dominio/respuestas.js';

async function aplicarMedico(tx: pg.PoolClient, tenantId: string, usuarioId: string, e: EventoMedico): Promise<void> {
  const nuevo = aplicarEventoMedico(await leerMedico(tx, tenantId, usuarioId), e);
  if (nuevo) await guardarMedico(tx, tenantId, usuarioId, nuevo);
}

const conflictoVersion = () => new Error('La cita cambió mientras se aplicaba la respuesta del paciente; se reintenta');

/**
 * Aplica la respuesta del paciente (o de recepción en su nombre) con las mismas reglas de dominio que el personal.
 * Una respuesta que ya no aplica solo deja un log `info` con el motivo (sin datos del paciente). El evento emitido copia
 * `actor_id` y `trace_id` del recibido y va al outbox en la misma transacción.
 */
async function aplicarRespuesta(e: EventEnvelope, tx: pg.PoolClient, logger: Logger | undefined): Promise<void> {
  const { data } = CitaRespuestaPaciente.parse(e);
  const cita = await leerCita(tx, e.tenant_id, data.citaId);
  if (!cita) {
    logger?.info({ citaId: data.citaId, motivo: 'inexistente' }, 'respuesta de paciente ignorada');
    return;
  }
  const decision = decidirRespuesta(cita, data);
  if (decision.accion === 'ignorar') {
    logger?.info({ citaId: cita.id, motivo: decision.motivo }, 'respuesta de paciente ignorada');
    return;
  }
  const base = { tenantId: e.tenant_id, actorId: e.actor_id, traceId: e.trace_id };
  const origen = data.origen;
  if (decision.accion === 'cancelar') {
    const nueva = await cambiarEstadoCita(tx, e.tenant_id, cita.id, cita.version, 'cancelada');
    if (!nueva) throw conflictoVersion();
    await enqueueEvent(tx, CitaCancelada.create({ ...base, data: { citaId: nueva.id, medicoId: nueva.medicoId, inicio: nueva.inicio, fin: nueva.fin, origen } }));
    return;
  }
  const nueva =
    decision.accion === 'confirmar'
      ? await cambiarEstadoCita(tx, e.tenant_id, cita.id, cita.version, 'confirmada')
      : await marcarPideCambio(tx, e.tenant_id, cita.id, cita.version);
  if (!nueva) throw conflictoVersion();
  await enqueueEvent(
    tx,
    CitaEstadoCambiado.create({
      ...base,
      data: { citaId: nueva.id, medicoId: nueva.medicoId, de: cita.estado, a: nueva.estado, origen, ...(decision.accion === 'marcar_cambio' ? { pideCambio: true } : {}) },
    }),
  );
}

/** Traduce un evento de identidad a la copia local (consultorio y médicos) y aplica las respuestas de pacientes. Toda escritura es idempotente. */
export async function manejarEvento(e: EventEnvelope, tx: pg.PoolClient, logger?: Logger): Promise<void> {
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
    case 'cita.respuesta_paciente@1':
      await aplicarRespuesta(e, tx, logger);
      return;
    default:
      throw new Error(`evento no soportado: ${e.type} v${e.version}`);
  }
}

/** Consumidor durable `agenda`: mantiene la copia local de consultorio y médicos, y aplica las respuestas de pacientes. */
export function iniciarConsumidor(o: { pool: pg.Pool; nc: NatsConnection; logger?: Logger }): Promise<{ stop(): Promise<void> }> {
  return consumeEvents({
    pool: o.pool,
    nc: o.nc,
    consumidor: 'agenda',
    subjects: ['evt.tenant.creado', 'evt.usuario.vinculado', 'evt.miembro.actualizado', 'evt.usuario.desvinculado', 'evt.cita.respuesta_paciente'],
    handler: (e, tx) => manejarEvento(e, tx, o.logger),
    ...(o.logger ? { logger: o.logger } : {}),
  });
}
