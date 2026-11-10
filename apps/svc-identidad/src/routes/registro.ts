import { TenantCreado, UsuarioVinculado, type EventEnvelope } from '@consultorio/contracts';
import { AppError, enqueueEvent, uuidv7, withTenant } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Auth } from '../auth.js';
import { isUniqueViolation } from '../db/errors.js';

const ZONAS = new Set(Intl.supportedValuesOf('timeZone'));

export const registroSchema = z.strictObject({
  nombreConsultorio: z.string().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  zonaHoraria: z.string().refine((z) => ZONAS.has(z), 'zona horaria IANA inválida'),
  admin: z.strictObject({
    nombre: z.string().min(1).max(120),
    email: z.email().transform((e) => e.toLowerCase()),
    password: z.string().min(10).max(128),
  }),
});
export type RegistroInput = z.infer<typeof registroSchema>;

export interface PlanTenant {
  tenantId: string;
  usuarioId: string;
  input: RegistroInput;
  eventos: EventEnvelope[];
}

/** Dependencias de la orquestación (reales en `createRegistroDeps`, dobles en las pruebas unitarias). */
export interface RegistroDeps {
  existeSlug(slug: string): Promise<boolean>;
  existeEmail(email: string): Promise<boolean>;
  crearUsuario(i: { nombre: string; email: string; password: string }): Promise<{ id: string }>;
  /** Una sola transacción: tenant, membresía admin y eventos en el outbox. */
  crearTenant(plan: PlanTenant): Promise<void>;
  /** Compensación: elimina el usuario y sus filas dependientes (cuenta, sesiones, 2FA). */
  borrarUsuario(usuarioId: string): Promise<void>;
  log: { error(obj: object, msg: string): void };
}

const conflicto = (campo: 'slug' | 'email'): AppError =>
  new AppError('CONFLICTO', campo === 'slug' ? 'El identificador del consultorio ya está en uso' : 'El correo ya está registrado', 409, { campo });

export function construirEventos(i: { tenantId: string; usuarioId: string; input: RegistroInput; traceId: string }): EventEnvelope[] {
  const base = { tenantId: i.tenantId, actorId: i.usuarioId, traceId: i.traceId };
  return [
    TenantCreado.create({
      ...base,
      data: {
        tenantId: i.tenantId,
        nombre: i.input.nombreConsultorio,
        slug: i.input.slug,
        zonaHoraria: i.input.zonaHoraria,
        adminUsuarioId: i.usuarioId,
      },
    }),
    UsuarioVinculado.create({ ...base, data: { usuarioId: i.usuarioId, rol: 'admin' } }),
  ];
}

/**
 * Orden: verificar slug y email libres → crear usuario → transacción del tenant → si falla, compensar.
 * Las verificaciones previas solo dan un 409 rápido; la garantía real ante concurrencia son las
 * restricciones únicas (tenant.slug, "user".email): un 23505 en cualquier punto también es 409.
 */
export async function registrarConsultorio(
  deps: RegistroDeps,
  input: RegistroInput,
  traceId: string,
): Promise<{ tenantId: string; usuarioId: string }> {
  if (await deps.existeSlug(input.slug)) throw conflicto('slug');
  if (await deps.existeEmail(input.admin.email)) throw conflicto('email');

  const usuario = await deps.crearUsuario(input.admin);
  const tenantId = uuidv7();
  try {
    const eventos = construirEventos({ tenantId, usuarioId: usuario.id, input, traceId });
    await deps.crearTenant({ tenantId, usuarioId: usuario.id, input, eventos });
  } catch (err) {
    try {
      await deps.borrarUsuario(usuario.id);
    } catch (errCompensacion) {
      // Usuario huérfano: requiere limpieza manual. Nunca se traga en silencio ni se registra la contraseña.
      deps.log.error({ err: errCompensacion, usuarioId: usuario.id, slug: input.slug }, 'compensación fallida: usuario huérfano tras registro');
    }
    throw isUniqueViolation(err) ? conflicto('slug') : err;
  }
  return { tenantId, usuarioId: usuario.id };
}

export function createRegistroDeps(pool: pg.Pool, auth: Pick<Auth, 'api'>, log: RegistroDeps['log']): RegistroDeps {
  const existeEmail = async (email: string): Promise<boolean> =>
    (await pool.query('SELECT 1 FROM "user" WHERE email = $1', [email])).rowCount === 1;
  return {
    log,
    existeSlug: async (slug) => (await pool.query('SELECT 1 FROM tenant WHERE slug = $1', [slug])).rowCount === 1,
    existeEmail,
    async crearUsuario(i) {
      try {
        const r = await auth.api.signUpEmail({ body: { name: i.nombre, email: i.email, password: i.password } });
        return { id: r.user.id };
      } catch (err) {
        // Dos registros simultáneos con el mismo email: Better Auth envuelve el 23505 de la BD en un
        // APIError genérico sin la causa, así que ante cualquier fallo se revisa si el email ya existe;
        // si es así fue un choque de unicidad → 409.
        if (isUniqueViolation(err) || (await existeEmail(i.email))) throw conflicto('email');
        throw err;
      }
    },
    crearTenant: (plan) =>
      withTenant(pool, plan.tenantId, async (tx) => {
        await tx.query('INSERT INTO tenant (id, nombre, slug, zona_horaria) VALUES ($1, $2, $3, $4)', [
          plan.tenantId,
          plan.input.nombreConsultorio,
          plan.input.slug,
          plan.input.zonaHoraria,
        ]);
        await tx.query("INSERT INTO membresia (tenant_id, usuario_id, rol) VALUES ($1, $2, 'admin')", [plan.tenantId, plan.usuarioId]);
        for (const e of plan.eventos) await enqueueEvent(tx, e);
      }),
    // Las FK de session/account/twoFactor son ON DELETE CASCADE.
    borrarUsuario: async (usuarioId) => {
      await pool.query('DELETE FROM "user" WHERE id = $1', [usuarioId]);
    },
  };
}

export interface RegistroRoutesOptions {
  deps: RegistroDeps;
}

/** POST /registro (pública): crea el consultorio y su administrador. */
export const registroRoutes: FastifyPluginAsync<RegistroRoutesOptions> = async (app, { deps }) => {
  app.post('/registro', async (req, reply) => {
    const input = registroSchema.parse(req.body);
    const r = await registrarConsultorio(deps, input, req.ctx.traceId);
    return reply.code(201).send(r);
  });
};
