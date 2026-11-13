import { z } from 'zod';

/**
 * Fila de `GET /api/auditoria/eventos`: el servicio devuelve las filas de la base tal cual (snake_case).
 * `secuencia` es bigint en la base y puede llegar como cadena; aquí siempre queda como cadena.
 */
export const eventoAuditoriaSchema = z.object({
  id: z.string(),
  secuencia: z.union([z.string(), z.number()]).transform(String),
  ocurrido_en: z.string(),
  actor_id: z.string().nullable().optional(),
  accion: z.string(),
  recurso_tipo: z.string().nullable().optional(),
  recurso_id: z.string().nullable().optional(),
  servicio: z.string().optional(),
  /** `data` del evento (JSON libre; cada acción define su forma); null si no traía datos. */
  detalle: z.unknown().optional(),
});
export type EventoAuditoria = z.infer<typeof eventoAuditoriaSchema>;

export const paginaEventosSchema = z.object({
  eventos: z.array(eventoAuditoriaSchema),
  siguiente: z.number().nullable(),
});
export type PaginaEventos = z.infer<typeof paginaEventosSchema>;

/** Filtros ya en el formato de la API (instantes ISO). */
export interface ConsultaBitacora {
  desde?: string;
  hasta?: string;
  accion?: string;
}

export type LecturaEventos = ({ ok: true } & PaginaEventos) | { ok: false; mensaje: string };
