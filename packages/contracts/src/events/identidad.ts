import { z } from 'zod';
import { rolSchema } from '../auth.js';
import { defineEvent } from '../envelope.js';

export const TenantCreado = defineEvent(
  'tenant.creado',
  1,
  z.object({
    tenantId: z.string().uuid(),
    nombre: z.string(),
    slug: z.string(),
    zonaHoraria: z.string(),
    adminUsuarioId: z.string().uuid(),
  }),
);

export const UsuarioVinculado = defineEvent(
  'usuario.vinculado',
  1,
  z.object({ usuarioId: z.string().uuid(), rol: rolSchema }),
);

export const UsuarioDesvinculado = defineEvent('usuario.desvinculado', 1, z.object({ usuarioId: z.string().uuid() }));

export const MedicoActualizado = defineEvent(
  'medico.actualizado',
  1,
  z.object({ usuarioId: z.string().uuid(), cedulaProfesional: z.string(), especialidad: z.string() }),
);
