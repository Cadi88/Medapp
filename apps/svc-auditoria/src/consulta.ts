import { z } from 'zod';

export const LIMITE_POR_DEFECTO = 50;
export const LIMITE_MAXIMO = 200;

const fechaIso = z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString());

const consultaSchema = z
  .strictObject({
    desde: fechaIso.optional(),
    hasta: fechaIso.optional(),
    // La query llega como string: solo enteros positivos sin signo ni decimales.
    limite: z
      .string()
      .regex(/^[0-9]+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(LIMITE_MAXIMO))
      .optional(),
  })
  .refine((q) => q.desde === undefined || q.hasta === undefined || q.desde <= q.hasta, {
    message: 'desde debe ser anterior o igual a hasta',
    path: ['desde'],
  });

export interface ConsultaEventos {
  desde?: string;
  hasta?: string;
  limite: number;
}

/** Valida y normaliza la query de `GET /eventos`; lanza ZodError (→ 400 VALIDACION) si es inválida. */
export function parseConsulta(query: unknown): ConsultaEventos {
  const q = consultaSchema.parse(query);
  return {
    ...(q.desde !== undefined ? { desde: q.desde } : {}),
    ...(q.hasta !== undefined ? { hasta: q.hasta } : {}),
    limite: q.limite ?? LIMITE_POR_DEFECTO,
  };
}

export const COLUMNAS_EVENTO =
  'id, tenant_id, secuencia, ocurrido_en, actor_id, accion, recurso_tipo, recurso_id, servicio, detalle, hash_anterior, hash';

/** SQL parametrizado del listado, siempre acotado al tenant (además de RLS). Orden `secuencia desc`. */
export function construirListado(tenantId: string, q: ConsultaEventos): { text: string; values: unknown[] } {
  const values: unknown[] = [tenantId];
  const where = ['tenant_id = $1'];
  if (q.desde !== undefined) {
    values.push(q.desde);
    where.push(`ocurrido_en >= $${values.length}`);
  }
  if (q.hasta !== undefined) {
    values.push(q.hasta);
    where.push(`ocurrido_en <= $${values.length}`);
  }
  values.push(q.limite);
  return {
    text: `SELECT ${COLUMNAS_EVENTO} FROM evento_auditoria WHERE ${where.join(' AND ')} ORDER BY secuencia DESC LIMIT $${values.length}`,
    values,
  };
}
