import {
  cambiarEstadoSchema,
  CitaCancelada,
  CitaCreada,
  CitaEstadoCambiado,
  CitaReprogramada,
  crearCitaSchema,
  reprogramarCitaSchema,
  type Cita,
} from '@consultorio/contracts';
import { AppError, enqueueEvent, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { listarBloqueos } from '../datos/bloqueos.js';
import { cambiarEstadoCita, insertarCita, leerCita, listarCitas, reprogramarCita } from '../datos/citas.js';
import { traducirErrorPg } from '../datos/errores.js';
import { leerHorario } from '../datos/horario.js';
import { leerZonaHoraria } from '../datos/medicos.js';
import { leerTipoCita } from '../datos/tipos-cita.js';
import { puedeReprogramar, transicionPermitida } from '../dominio/estados.js';
import { encajaEnHorario } from '../dominio/horario.js';
import { rangoDeCita } from '../dominio/tiempo.js';
import { exigirGestion } from './acceso.js';

const paramsId = z.object({ id: z.uuid() });
const instante = z.iso.datetime({ offset: true });
const queryListado = z.object({ desde: instante, hasta: instante, medicoId: z.uuid().optional() });
const MAX_RANGO_MS = 31 * 24 * 60 * 60 * 1000;

export interface CitasOpciones {
  pool: pg.Pool;
  reloj: () => Date;
}

const conflictoVersion = () => new AppError('CONFLICTO_VERSION', 'La cita fue modificada por otra persona; recarga e inténtalo de nuevo', 409);

/**
 * Validaciones comunes del alta y la reprogramación; devuelve el rango (UTC) y si queda fuera del horario.
 * El tipo debe estar activo y ser del médico destino (la FK no lo garantiza). La base (EXCLUDE) es la barrera final contra traslapes.
 */
async function validarHueco(
  tx: pg.PoolClient,
  tenantId: string,
  ahora: Date,
  d: { medicoId: string; tipoCitaId: string; inicio: string; fueraDeHorario: boolean },
): Promise<{ inicio: string; fin: string; fueraDeHorario: boolean }> {
  const tipo = await leerTipoCita(tx, tenantId, d.medicoId, d.tipoCitaId);
  if (!tipo?.activo) throw new AppError('VALIDACION', 'El tipo de cita no existe, está inactivo o no es de este médico', 400);
  const rango = rangoDeCita(d.inicio, tipo.duracionMin);
  if (rango.inicio.toMillis() < ahora.getTime()) throw new AppError('VALIDACION', 'La cita no puede empezar en el pasado', 400);
  const inicio = rango.inicio.toISO()!;
  const fin = rango.fin.toISO()!;
  if ((await listarBloqueos(tx, tenantId, d.medicoId, inicio, fin)).length > 0) {
    throw new AppError('HORARIO_BLOQUEADO', 'El médico tiene un bloqueo en ese horario', 409);
  }
  const zona = await leerZonaHoraria(tx, tenantId);
  if (!zona) throw new AppError('NO_ENCONTRADO', 'Consultorio no inicializado', 404);
  const dentro = encajaEnHorario(rango, await leerHorario(tx, tenantId, d.medicoId), zona);
  if (!dentro && !d.fueraDeHorario) throw new AppError('FUERA_DE_HORARIO', 'El horario queda fuera de la jornada del médico', 422);
  return { inicio, fin, fueraDeHorario: !dentro };
}

/** Carga la cita y autoriza sobre su médico (aunque esté inactivo: sus citas se conservan); 404 si no existe en el tenant. */
async function cargarCita(req: FastifyRequest, tx: pg.PoolClient, id: string): Promise<Cita> {
  const cita = await leerCita(tx, req.ctx.tenantId, id);
  if (!cita) throw new AppError('NO_ENCONTRADO', 'Cita no encontrada', 404);
  await exigirGestion(req, tx, cita.medicoId, { permitirInactivo: true });
  return cita;
}

export const citasRutas: FastifyPluginAsync<CitasOpciones> = async (app, { pool, reloj }) => {
  app.post('/citas', async (req, reply) => {
    const input = crearCitaSchema.parse(req.body);
    const { tenantId, usuarioId, traceId } = req.ctx;
    const creada = await withTenant(pool, tenantId, async (tx) => {
      await exigirGestion(req, tx, input.medicoId);
      const hueco = await validarHueco(tx, tenantId, reloj(), input);
      try {
        const cita = await insertarCita(tx, tenantId, {
          id: uuidv7(),
          medicoId: input.medicoId,
          tipoCitaId: input.tipoCitaId,
          inicio: hueco.inicio,
          fin: hueco.fin,
          contacto: input.contacto,
          notas: input.notas,
          fueraDeHorario: hueco.fueraDeHorario,
          creadaPor: usuarioId,
        });
        await enqueueEvent(
          tx,
          CitaCreada.create({
            tenantId,
            actorId: usuarioId,
            traceId,
            data: {
              citaId: cita.id,
              medicoId: cita.medicoId,
              tipoCitaId: cita.tipoCitaId,
              inicio: cita.inicio,
              fin: cita.fin,
              estado: cita.estado,
              origen: 'recepcion',
              fueraDeHorario: cita.fueraDeHorario,
            },
          }),
        );
        return cita;
      } catch (err) {
        throw traducirErrorPg(err) ?? err;
      }
    });
    return reply.code(201).send(creada);
  });

  app.patch('/citas/:id', async (req) => {
    const { id } = paramsId.parse(req.params);
    const input = reprogramarCitaSchema.parse(req.body);
    const { tenantId, usuarioId, traceId } = req.ctx;
    return withTenant(pool, tenantId, async (tx) => {
      const actual = await cargarCita(req, tx, id);
      const medicoId = input.medicoId ?? actual.medicoId;
      // El destino debe estar activo (también si es el mismo médico): mover la cita equivale a ocupar un hueco nuevo.
      await exigirGestion(req, tx, medicoId);
      if (actual.version !== input.version) throw conflictoVersion();
      if (!puedeReprogramar(actual.estado)) throw new AppError('CONFLICTO', `No se puede reprogramar una cita ${actual.estado}`, 409);
      const tipoCitaId = input.tipoCitaId ?? actual.tipoCitaId;
      const hueco = await validarHueco(tx, tenantId, reloj(), { medicoId, tipoCitaId, inicio: input.inicio, fueraDeHorario: input.fueraDeHorario });
      try {
        // La versión también se exige en el UPDATE: una petición concurrente que la haya subido deja 0 filas.
        const cita = await reprogramarCita(tx, tenantId, id, input.version, { medicoId, tipoCitaId, ...hueco });
        if (!cita) throw conflictoVersion();
        await enqueueEvent(
          tx,
          CitaReprogramada.create({
            tenantId,
            actorId: usuarioId,
            traceId,
            data: {
              citaId: cita.id,
              medicoId: cita.medicoId,
              inicio: cita.inicio,
              fin: cita.fin,
              anterior: { medicoId: actual.medicoId, inicio: actual.inicio, fin: actual.fin },
            },
          }),
        );
        return cita;
      } catch (err) {
        throw traducirErrorPg(err) ?? err;
      }
    });
  });

  app.post('/citas/:id/estado', async (req) => {
    const { id } = paramsId.parse(req.params);
    const input = cambiarEstadoSchema.parse(req.body);
    const { tenantId, usuarioId, traceId } = req.ctx;
    return withTenant(pool, tenantId, async (tx) => {
      const actual = await cargarCita(req, tx, id);
      if (actual.version !== input.version) throw conflictoVersion();
      if (!transicionPermitida(actual.estado, input.estado)) {
        throw new AppError('CONFLICTO', `Transición de estado no permitida: ${actual.estado} a ${input.estado}`, 409);
      }
      const cita = await cambiarEstadoCita(tx, tenantId, id, input.version, input.estado);
      if (!cita) throw conflictoVersion();
      const base = { tenantId, actorId: usuarioId, traceId };
      await enqueueEvent(
        tx,
        input.estado === 'cancelada'
          ? CitaCancelada.create({ ...base, data: { citaId: cita.id, medicoId: cita.medicoId, inicio: cita.inicio, fin: cita.fin } })
          : CitaEstadoCambiado.create({ ...base, data: { citaId: cita.id, medicoId: cita.medicoId, de: actual.estado, a: cita.estado } }),
      );
      return cita;
    });
  });

  app.get('/citas', async (req) => {
    const { desde, hasta, medicoId } = queryListado.parse(req.query);
    const dur = Date.parse(hasta) - Date.parse(desde);
    if (dur <= 0 || dur > MAX_RANGO_MS) throw new AppError('VALIDACION', 'El rango debe ser positivo y de máximo 31 días', 400);
    const { tenantId, usuarioId, rol, admin } = req.ctx;
    return withTenant(pool, tenantId, async (tx) => {
      // Las citas de un médico ya inactivo se siguen consultando.
      if (medicoId) await exigirGestion(req, tx, medicoId, { permitirInactivo: true });
      // Un médico sin privilegios de admin solo ve su propia agenda aunque no filtre.
      const filtro = medicoId ?? (rol === 'medico' && !admin ? usuarioId : undefined);
      return { citas: await listarCitas(tx, tenantId, desde, hasta, filtro) };
    });
  });

  app.get('/citas/:id', async (req) => {
    const { id } = paramsId.parse(req.params);
    return withTenant(pool, req.ctx.tenantId, (tx) => cargarCita(req, tx, id));
  });
};
