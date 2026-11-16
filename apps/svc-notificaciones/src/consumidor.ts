import type { NatsConnection } from '@nats-io/transport-node';
import { CitaCancelada, CitaCreada, CitaReprogramada, type EventEnvelope } from '@consultorio/contracts';
import { consumeEvents } from '@consultorio/platform';
import type pg from 'pg';
import type { Logger } from 'pino';
import { leerZonaHoraria, registrarConsultorio } from './datos/consultorios.js';
import { anularNoEnviados, anularPorReprogramacion } from './datos/envios.js';
import { fechaCitaLocal } from './dominio/calendario.js';
import type { ClienteIdentidad } from './puertos.js';

/** Zona del consultorio; la primera vez que se ve el consultorio se pide a identidad y queda registrado para el programador. */
async function zonaDelConsultorio(tx: pg.PoolClient, tenantId: string, identidad: ClienteIdentidad): Promise<string> {
  const conocida = await leerZonaHoraria(tx, tenantId);
  if (conocida) return conocida;
  const { zonaHoraria } = await identidad.obtenerConsultorio(tenantId);
  await registrarConsultorio(tx, tenantId, zonaHoraria);
  return zonaHoraria;
}

/**
 * Traduce un evento de cita al estado de los envíos. No crea envíos (los crea `asegurarEnvios`). Toda escritura es idempotente.
 * Los eventos de citas no llevan datos de contacto del paciente.
 */
export async function manejarEvento(e: EventEnvelope, tx: pg.PoolClient, identidad: ClienteIdentidad): Promise<void> {
  switch (`${e.type}@${e.version}`) {
    case 'cita.creada@1': {
      CitaCreada.parse(e);
      await zonaDelConsultorio(tx, e.tenant_id, identidad);
      return;
    }
    case 'cita.reprogramada@1': {
      const { data } = CitaReprogramada.parse(e);
      const zona = await zonaDelConsultorio(tx, e.tenant_id, identidad);
      await anularPorReprogramacion(tx, e.tenant_id, data.citaId, fechaCitaLocal(data.anterior.inicio, zona));
      return;
    }
    case 'cita.cancelada@1': {
      // Anular no necesita la zona: no se llama a identidad.
      const { data } = CitaCancelada.parse(e);
      await anularNoEnviados(tx, e.tenant_id, data.citaId);
      return;
    }
    default:
      throw new Error(`evento no soportado: ${e.type} v${e.version}`);
  }
}

/** Consumidor durable `notificaciones`: registra consultorios y anula los envíos que dejan de valer. */
export function iniciarConsumidor(o: { pool: pg.Pool; nc: NatsConnection; identidad: ClienteIdentidad; logger?: Logger }): Promise<{ stop(): Promise<void> }> {
  return consumeEvents({
    pool: o.pool,
    nc: o.nc,
    consumidor: 'notificaciones',
    subjects: ['evt.cita.creada', 'evt.cita.reprogramada', 'evt.cita.cancelada'],
    handler: (e, tx) => manejarEvento(e, tx, o.identidad),
    ...(o.logger ? { logger: o.logger } : {}),
  });
}
