import type { NatsConnection } from '@nats-io/transport-node';
import { CitaCancelada, CitaCreada, CitaReprogramada, type EventEnvelope } from '@consultorio/contracts';
import { consumeEvents } from '@consultorio/platform';
import { DateTime } from 'luxon';
import type pg from 'pg';
import type { Logger } from 'pino';
import { leerZonaHoraria, registrarConsultorio } from './datos/consultorios.js';
import { anularNoEnviados, anularPorReprogramacion } from './datos/envios.js';
import { leerConfig } from './datos/config.js';
import { debeEnviarInmediato, fechaCitaLocal } from './dominio/calendario.js';
import type { ContextoEnvio } from './envio.js';
import { enviarInmediato } from './programador.js';
import type { ClienteIdentidad } from './puertos.js';

/** Cita que acaba de quedar (o moverse) en una fecha: candidata al envío inmediato tras confirmarse la transacción. */
export interface CitaParaEnvioInmediato {
  citaId: string;
  inicio: string;
}

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
export async function manejarEvento(e: EventEnvelope, tx: pg.PoolClient, identidad: ClienteIdentidad): Promise<CitaParaEnvioInmediato | undefined> {
  switch (`${e.type}@${e.version}`) {
    case 'cita.creada@1': {
      const { data } = CitaCreada.parse(e);
      await zonaDelConsultorio(tx, e.tenant_id, identidad);
      return { citaId: data.citaId, inicio: data.inicio };
    }
    case 'cita.reprogramada@1': {
      const { data } = CitaReprogramada.parse(e);
      const zona = await zonaDelConsultorio(tx, e.tenant_id, identidad);
      await anularPorReprogramacion(tx, e.tenant_id, data.citaId, fechaCitaLocal(data.anterior.inicio, zona));
      return { citaId: data.citaId, inicio: data.inicio };
    }
    case 'cita.cancelada@1': {
      // Anular no necesita la zona: no se llama a identidad.
      const { data } = CitaCancelada.parse(e);
      await anularNoEnviados(tx, e.tenant_id, data.citaId);
      return undefined;
    }
    default:
      throw new Error(`evento no soportado: ${e.type} v${e.version}`);
  }
}

/** Envíos inmediatos simultáneos como máximo por proceso (el resto espera su turno): una ráfaga de citas no satura agenda ni el SMTP. */
export const MAX_ENVIOS_INMEDIATOS = 3;

/** Limita a `max` las tareas en vuelo; las demás esperan en orden. */
export function crearLimitador(max: number): <T>(tarea: () => Promise<T>) => Promise<T> {
  let activas = 0;
  const cola: (() => void)[] = [];
  const siguiente = (): void => {
    const turno = cola.shift();
    if (turno) turno();
    else activas -= 1;
  };
  return async <T>(tarea: () => Promise<T>): Promise<T> => {
    if (activas < max) activas += 1;
    else await new Promise<void>((r) => cola.push(r));
    try {
      return await tarea();
    } finally {
      siguiente();
    }
  };
}

const ESPERA_CONFIRMACION_MS = 30_000;
const SONDEO_CONFIRMACION_MS = 100;

/**
 * Consumidor durable `notificaciones`: registra consultorios y anula los envíos que dejan de valer.
 * Con `envio`, tras confirmarse la transacción de una cita creada/reprogramada intenta el envío inmediato (`enviarInmediato`).
 *
 * `consumeEvents` ejecuta el handler DENTRO de la transacción (inbox + handler) y hace COMMIT después, así que el envío
 * (HTTP/SMTP) no puede ir en el handler. El handler solo anota la cita; un paso aparte, fuera de la transacción, espera a
 * ver la fila de `inbox` del evento desde otra conexión (prueba de que se confirmó) y entonces envía. Si la transacción se
 * revierte la fila nunca aparece y se descarta (el evento se reentrega y se anota de nuevo). Si el proceso muere entre el
 * COMMIT y el envío, el correo no sale solo: queda pendiente y se envía desde la pantalla de recordatorios.
 */
export async function iniciarConsumidor(o: { pool: pg.Pool; nc: NatsConnection; identidad: ClienteIdentidad; logger?: Logger; envio?: ContextoEnvio }): Promise<{ stop(): Promise<void> }> {
  const pendientes = new Set<Promise<void>>();
  const limitar = crearLimitador(MAX_ENVIOS_INMEDIATOS);
  let detenido = false;
  const tras = (e: EventEnvelope, cita: CitaParaEnvioInmediato, ctx: ContextoEnvio): void => {
    const tarea: Promise<void> = (async () => {
      const limite = Date.now() + ESPERA_CONFIRMACION_MS;
      for (;;) {
        const r = await o.pool.query('SELECT 1 FROM inbox WHERE event_id = $1 AND consumidor = $2', [e.event_id, 'notificaciones']);
        if (r.rowCount === 1) break;
        if (detenido || Date.now() > limite) {
          o.logger?.warn({ event_id: e.event_id, detenido }, 'el evento no se confirmó a tiempo; se omite el envío inmediato');
          return;
        }
        await new Promise((res) => setTimeout(res, SONDEO_CONFIRMACION_MS));
      }
      await limitar(() => enviarInmediato(ctx, e.tenant_id, cita.citaId, cita.inicio));
    })()
      .catch((err: unknown) => o.logger?.error({ err, event_id: e.event_id }, 'falló el envío inmediato de la cita'))
      .finally(() => pendientes.delete(tarea));
    pendientes.add(tarea);
  };
  const consumidor = await consumeEvents({
    pool: o.pool,
    nc: o.nc,
    consumidor: 'notificaciones',
    subjects: ['evt.cita.creada', 'evt.cita.reprogramada', 'evt.cita.cancelada'],
    handler: async (e, tx) => {
      const cita = await manejarEvento(e, tx, o.identidad);
      if (!cita || !o.envio) return;
      // Solo se agenda el envío si de verdad aplica (sin_revision, cita de mañana, hora de envío ya pasada): evita una espera por cada cita.
      const zona = await leerZonaHoraria(tx, e.tenant_id);
      if (!zona) return;
      const config = await leerConfig(tx, e.tenant_id);
      if (debeEnviarInmediato(DateTime.fromJSDate(o.envio.reloj()), zona, config.modo, config.horaEnvio, cita.inicio)) tras(e, cita, o.envio);
    },
    ...(o.logger ? { logger: o.logger } : {}),
  });
  return {
    async stop() {
      await consumidor.stop();
      detenido = true;
      await Promise.all(pendientes);
    },
  };
}
