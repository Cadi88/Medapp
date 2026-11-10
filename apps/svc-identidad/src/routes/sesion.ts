import type { Rol } from '@consultorio/contracts';
import { AppError } from '@consultorio/platform';
import type { FastifyPluginAsync } from 'fastify';
import type { JWK } from 'jose';
import type pg from 'pg';
import type { Auth } from '../auth.js';
import { publicJwkFrom } from '../jwt-keys.js';
import { decidirToken } from '../reglas.js';
import { requerirSesion } from '../session.js';
import { firmarTokenTenant } from '../tokens.js';
import { tenantBodySchema } from '../validadores.js';

export interface SesionRoutesOptions {
  auth: Pick<Auth, 'api'>;
  pool: pg.Pool;
  jwtPrivateJwk: JWK;
}

interface Membresia {
  tenantId: string;
  nombre: string;
  slug: string;
  rol: Rol;
}

/**
 * Única vía de lectura de membresías sin tenant activo. SOLO se llama con el id del usuario de la
 * sesión de Better Auth, nunca con un id enviado por el cliente.
 */
async function membresiasDe(pool: pg.Pool, usuarioId: string): Promise<Membresia[]> {
  const r = await pool.query<{ tenant_id: string; nombre: string; slug: string; rol: Rol }>(
    'SELECT tenant_id, nombre, slug, rol FROM fn_membresias_usuario($1)',
    [usuarioId],
  );
  return r.rows.map((m) => ({ tenantId: m.tenant_id, nombre: m.nombre, slug: m.slug, rol: m.rol }));
}

export const sesionRoutes: FastifyPluginAsync<SesionRoutesOptions> = async (app, { auth, pool, jwtPrivateJwk }) => {
  const jwks = { keys: [publicJwkFrom(jwtPrivateJwk)] };

  app.get('/.well-known/jwks.json', async (_req, reply) => {
    void reply.header('cache-control', 'public, max-age=300');
    return jwks;
  });

  app.get('/tenants/mios', async (req) => {
    const s = await requerirSesion(auth, req);
    return membresiasDe(pool, s.usuarioId);
  });

  app.post('/sesion/tenant', async (req) => {
    const s = await requerirSesion(auth, req);
    const { tenantId } = tenantBodySchema.parse(req.body);
    // Lectura fresca en cada llamada: un miembro removido no obtiene token nuevo.
    const m = (await membresiasDe(pool, s.usuarioId)).find((x) => x.tenantId === tenantId);
    if (!m) throw new AppError('PROHIBIDO', 'No eres miembro de este consultorio', 403);
    const d = decidirToken({ rol: m.rol, twoFactorEnabled: s.twoFactorEnabled });
    if (!d.ok) throw new AppError('MFA_REQUERIDA', 'Este rol requiere autenticación de dos factores', 403);
    const token = await firmarTokenTenant({ sub: s.usuarioId, tid: tenantId, rol: m.rol, mfa: d.mfa }, jwtPrivateJwk);
    return { token };
  });
};
