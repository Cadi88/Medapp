import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import type { CitaParaRecordatorio, ConsultorioParaMensaje } from '@consultorio/contracts';
import { createPool, ensureStreams, runMigrations } from '@consultorio/platform';
import { startNats, startPostgres, startTestJwks, type TestJwks, type TestNats, type TestPostgres } from '@consultorio/platform/testing';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import type { AlmacenLectura, CanalCorreo, ClienteAgenda, ClienteIdentidad, MensajeCorreo, Puertos } from '../../src/puertos.js';
import { buildServer } from '../../src/server.js';

export const TOKEN_INTERNO_PRUEBA = 'token-interno-de-pruebas-'.repeat(2);
export const WEB_ORIGEN_PRUEBA = 'http://web.test';
export const MIGRACIONES = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface ClaimsPrueba {
  sub?: string;
  tid: string;
  rol?: 'medico' | 'recepcion';
  admin?: boolean;
  mfa?: boolean;
}

/** Dobles de los puertos externos: los datos y los envíos son ajustables desde cada prueba. */
export interface Dobles {
  citas: CitaParaRecordatorio[];
  consultorio: ConsultorioParaMensaje;
  correosEnviados: MensajeCorreo[];
  /** Si se asigna, el siguiente `enviar` lanza este error. */
  fallaCorreo: Error | null;
  logos: Map<string, { bytes: Uint8Array; tipo: string }>;
}

export interface Notificaciones {
  app: FastifyInstance;
  pgh: TestPostgres;
  appPool: pg.Pool;
  migrator: pg.Pool;
  nats: TestNats;
  nc: NatsConnection;
  jwks: TestJwks;
  dobles: Dobles;
  puertos: Puertos;
  tokenPara(claims: ClaimsPrueba): Promise<string>;
  stop(): Promise<void>;
}

/** Las migraciones llevan el rol de producción `notificaciones_app`; en pruebas es `test_app`. */
async function migrar(url: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'notificaciones-mig-'));
  try {
    cpSync(MIGRACIONES, dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      writeFileSync(p, readFileSync(p, 'utf8').replaceAll('"notificaciones_app"', '"test_app"'));
    }
    await runMigrations(url, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function iniciarNotificaciones(opciones: { reloj?: () => Date } = {}): Promise<Notificaciones> {
  const [pgh, nats, jwks] = await Promise.all([startPostgres(), startNats(), startTestJwks()]);
  await migrar(pgh.migratorUrl);
  const migrator = createPool(pgh.migratorUrl);
  const appPool = createPool(pgh.appUrl);
  const nc = await connect({ servers: nats.url });
  await ensureStreams(nc);

  const dobles: Dobles = {
    citas: [],
    consultorio: { nombreMostrado: 'Consultorio de prueba', telefono: '5512345678', colorPrimario: '#0f766e', colorTexto: '#ffffff', logoKey: null, zonaHoraria: 'America/Mexico_City', pais: 'MX' },
    correosEnviados: [],
    fallaCorreo: null,
    logos: new Map(),
  };
  const agenda: ClienteAgenda = { obtenerCitas: async () => dobles.citas };
  const identidad: ClienteIdentidad = { obtenerConsultorio: async () => dobles.consultorio };
  const correo: CanalCorreo = {
    enviar: async (m) => {
      if (dobles.fallaCorreo) throw dobles.fallaCorreo;
      dobles.correosEnviados.push(m);
    },
  };
  const almacen: AlmacenLectura = { leer: async (llave) => dobles.logos.get(llave) ?? null };
  const puertos: Puertos = { agenda, identidad, correo, almacen };

  const app = await buildServer({
    pool: appPool,
    jwksUrl: jwks.url,
    tokenInterno: TOKEN_INTERNO_PRUEBA,
    webOrigen: WEB_ORIGEN_PRUEBA,
    reloj: opciones.reloj ?? (() => new Date()),
    puertos,
  });
  await app.ready();
  return {
    app,
    pgh,
    appPool,
    migrator,
    nats,
    nc,
    jwks,
    dobles,
    puertos,
    tokenPara: (c) => jwks.sign({ sub: c.sub ?? uuidv7(), tid: c.tid, rol: c.rol ?? 'recepcion', admin: c.admin ?? false, mfa: c.mfa ?? true }),
    stop: async () => {
      await app.close();
      await nc.drain();
      await migrator.end();
      await appPool.end();
      await jwks.stop();
      await nats.stop();
      await pgh.stop();
    },
  };
}
