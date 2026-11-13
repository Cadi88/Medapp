import { z } from 'zod';
import { rolSchema } from '../auth.js';
import { defineEvent } from '../envelope.js';
import { codigoPaisSchema, monedaSchema } from '../paises/tipos.js';

const tenantCreadoV1 = z.object({
  tenantId: z.string().uuid(),
  nombre: z.string(),
  slug: z.string(),
  zonaHoraria: z.string(),
  adminUsuarioId: z.string().uuid(),
});

/** Esquema anterior (v1, sin país ni moneda): los consumidores que aceptan ambas versiones lo siguen usando. */
export const TenantCreadoV1 = defineEvent('tenant.creado', 1, tenantCreadoV1);

export const TenantCreado = defineEvent(
  'tenant.creado',
  2,
  tenantCreadoV1.extend({ pais: codigoPaisSchema, moneda: monedaSchema }),
);

/** Esquema anterior (v1, con `admin` como rol): los consumidores que aceptan ambas versiones lo siguen usando. */
export const UsuarioVinculadoV1 = defineEvent(
  'usuario.vinculado',
  1,
  z.object({ usuarioId: z.string().uuid(), rol: z.enum(['admin', 'medico', 'recepcion']) }),
);

export const UsuarioVinculado = defineEvent(
  'usuario.vinculado',
  2,
  z.object({ usuarioId: z.string().uuid(), nombre: z.string(), rol: rolSchema, admin: z.boolean() }),
);

export const MiembroActualizado = defineEvent(
  'miembro.actualizado',
  1,
  z.object({ usuarioId: z.string().uuid(), nombre: z.string(), rol: rolSchema, admin: z.boolean() }),
);

export const UsuarioDesvinculado = defineEvent('usuario.desvinculado', 1, z.object({ usuarioId: z.string().uuid() }));

export const MedicoActualizado = defineEvent(
  'medico.actualizado',
  1,
  z.object({ usuarioId: z.string().uuid(), cedulaProfesional: z.string(), especialidad: z.string() }),
);

export const ConsultorioActualizado = defineEvent(
  'consultorio.actualizado',
  1,
  z.object({ campos: z.array(z.enum(['nombreComercial', 'direccion', 'telefono', 'colorPrimario', 'logo'])).min(1) }),
);
