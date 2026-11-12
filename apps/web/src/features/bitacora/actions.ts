'use server';

import { z } from 'zod';
import { estadoDeFallo } from '@/features/comun/errores';
import { listarEventos } from './api';
import { accionSchema } from './logica/filtros';
import type { LecturaEventos } from './tipos';

const instante = z.iso.datetime({ offset: true });
const paginaSchema = z.object({
  filtros: z.object({ desde: instante.optional(), hasta: instante.optional(), accion: accionSchema.optional() }),
  antesDe: z.number().int().min(1),
});

/** Página siguiente de la bitácora ("Ver más"): mismos filtros y el cursor `siguiente` de la página anterior. */
export async function cargarMasEventos(filtros: { desde?: string; hasta?: string; accion?: string }, antesDe: number): Promise<LecturaEventos> {
  const v = paginaSchema.safeParse({ filtros, antesDe });
  if (!v.success) return { ok: false, mensaje: 'Revisa los datos del formulario' };
  const r = await listarEventos({ ...v.data.filtros, antesDe: v.data.antesDe });
  return r.ok ? { ok: true, ...r.datos } : { ok: false, mensaje: estadoDeFallo(r).mensaje ?? '' };
}
