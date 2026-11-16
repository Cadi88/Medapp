import { withTenant } from '@consultorio/platform';
import { DateTime } from 'luxon';
import type pg from 'pg';
import { leerConfig } from './datos/config.js';
import { listarConsultorios, leerZonaHoraria } from './datos/consultorios.js';
import { registrarCorrida, ultimaCorrida } from './datos/corridas.js';
import { listarEnviosCorreoDeFecha } from './datos/envios.js';
import { corridaPendiente, debeEnviar, debeEnviarInmediato } from './dominio/calendario.js';
import { asegurarEnvios, enviarCorreo, type ContextoEnvio } from './envio.js';

/** Candado de sesión (`pg_try_advisory_lock`) propio de este servicio: una sola instancia recorre los consultorios a la vez. */
export const LOCK_PROGRAMADOR = '7305001';

export interface OpcionesProgramador {
  intervaloMs?: number;
}

/**
 * Corrida automática de un consultorio si ya pasó su hora local de envío y hoy no corrió: asegura los envíos de mañana,
 * envía los que corresponden según el modo y registra la corrida. Un fallo de agenda o identidad se propaga (sin corrida:
 * la vuelta siguiente lo reintenta). Un fallo transitorio del correo (aún con intentos) también deja la corrida sin registrar;
 * al agotar los 3 intentos el envío queda `fallido` y la corrida se registra.
 */
async function correrConsultorio(ctx: ContextoEnvio, tenantId: string, zona: string): Promise<void> {
  const { config, ultima } = await withTenant(ctx.pool, tenantId, async (tx) => ({ config: await leerConfig(tx, tenantId), ultima: await ultimaCorrida(tx, tenantId) }));
  const pendiente = corridaPendiente(DateTime.fromJSDate(ctx.reloj()), zona, config.horaEnvio, ultima);
  if (!pendiente) return;
  const { fechaEnvio, fechaCitas } = pendiente;
  await asegurarEnvios(ctx, tenantId, fechaCitas, fechaCitas);
  const envios = await withTenant(ctx.pool, tenantId, (tx) => listarEnviosCorreoDeFecha(tx, tenantId, fechaCitas));
  let reintentar = false;
  for (const envio of envios) {
    if (!debeEnviar(envio, config.modo)) continue;
    const r = await enviarCorreo(ctx, tenantId, envio.id);
    if (r.resultado === 'fallido' && (r.estado === 'pendiente' || r.estado === 'aprobado')) reintentar = true;
  }
  if (!reintentar) await withTenant(ctx.pool, tenantId, (tx) => registrarCorrida(tx, tenantId, fechaEnvio));
}

/** Una vuelta: toma el candado en un cliente dedicado (sin transacción abierta durante HTTP/SMTP), recorre los consultorios y lo suelta. */
async function vuelta(ctx: ContextoEnvio): Promise<void> {
  let cliente: pg.PoolClient | undefined;
  let candado = false;
  let descartar = false;
  try {
    cliente = await ctx.pool.connect();
    const r = await cliente.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_PROGRAMADOR]);
    candado = r.rows[0]?.ok === true;
    if (!candado) return;
    for (const { tenantId, zonaHoraria } of await listarConsultorios(cliente)) {
      try {
        await correrConsultorio(ctx, tenantId, zonaHoraria);
      } catch (err) {
        // Un consultorio con problemas (agenda caída, zona inválida…) no detiene a los demás; se reintenta en la vuelta siguiente.
        ctx.logger?.error({ err, tenantId }, 'falló la corrida automática del consultorio');
      }
    }
  } catch (err) {
    ctx.logger?.error({ err }, 'falló la vuelta del programador');
  } finally {
    if (candado && cliente) {
      try {
        await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK_PROGRAMADOR]);
      } catch (err) {
        // Sin poder soltarlo, se destruye la conexión: el candado de sesión muere con ella.
        descartar = true;
        ctx.logger?.error({ err }, 'no se pudo soltar el candado del programador');
      }
    }
    cliente?.release(descartar ? true : undefined);
  }
}

/**
 * Programador en el proceso: cada `intervaloMs` (1 min) recorre los consultorios. Dos instancias nunca corren a la vez
 * (candado de sesión) y, aun así, `enviarCorreo` reclama cada envío de forma atómica: el candado es una capa extra.
 * `correrAhora` fuerza una vuelta (pruebas); si ya hay una en curso en esta instancia, espera a esa.
 */
export function iniciarProgramador(ctx: ContextoEnvio, o: OpcionesProgramador = {}): { detener(): Promise<void>; correrAhora(): Promise<void> } {
  let enCurso: Promise<void> | null = null;
  const correrAhora = (): Promise<void> => {
    enCurso ??= vuelta(ctx).finally(() => {
      enCurso = null;
    });
    return enCurso;
  };
  const temporizador = setInterval(() => {
    // Una vuelta nunca debe tumbar el proceso con un rechazo sin manejar.
    correrAhora().catch((err: unknown) => ctx.logger?.error({ err }, 'falló la vuelta del programador'));
  }, o.intervaloMs ?? 60_000);
  return {
    correrAhora,
    async detener() {
      clearInterval(temporizador);
      await enCurso;
    },
  };
}

/**
 * Cita creada o reprogramada para mañana (zona del consultorio) cuando ya pasó la hora de envío de hoy: en `sin_revision`
 * sale en ese momento; en `con_revision` queda pendiente de aprobar. Hace HTTP/SMTP: nunca llamarla dentro de una transacción.
 */
export async function enviarInmediato(ctx: ContextoEnvio, tenantId: string, citaId: string, inicio: string): Promise<void> {
  const { zona, config } = await withTenant(ctx.pool, tenantId, async (tx) => ({ zona: await leerZonaHoraria(tx, tenantId), config: await leerConfig(tx, tenantId) }));
  if (!zona) return;
  const r = debeEnviarInmediato(DateTime.fromJSDate(ctx.reloj()), zona, config.modo, config.horaEnvio, inicio);
  if (!r) return;
  const fecha = r.fechaCita;
  await asegurarEnvios(ctx, tenantId, fecha, fecha);
  const envio = (await withTenant(ctx.pool, tenantId, (tx) => listarEnviosCorreoDeFecha(tx, tenantId, fecha))).find((e) => e.citaId === citaId);
  if (envio) await enviarCorreo(ctx, tenantId, envio.id);
}
