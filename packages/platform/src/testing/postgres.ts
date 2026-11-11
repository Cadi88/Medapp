import { execFileSync } from 'node:child_process';
import { GenericContainer, Wait } from 'testcontainers';
import pg from 'pg';

export interface TestPostgres {
  migratorUrl: string;
  appUrl: string;
  stop(): Promise<void>;
  /** Congela el contenedor (simula la base caída: las conexiones se cuelgan, no se cierran). Igual que `startNats().pause()`. */
  pause(): Promise<void>;
  unpause(): Promise<void>;
}

const SUPER_PW = 'super_pw';
const MIGRATOR_PW = 'migrator_pw';
const APP_PW = 'app_pw';

/** Postgres 16 efímero con los mismos roles que docker/postgres/init.sql: test_migrator (dueño) y test_app (NOBYPASSRLS). */
export async function startPostgres(): Promise<TestPostgres> {
  const container = await new GenericContainer('postgres:16')
    .withEnvironment({ POSTGRES_PASSWORD: SUPER_PW, POSTGRES_DB: 'postgres' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const id = container.getId();
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const url = (user: string, pw: string, db: string) => `postgres://${user}:${pw}@${host}:${port}/${db}`;

  const admin = async (db: string, sql: string[]) => {
    const c = new pg.Client({ connectionString: url('postgres', SUPER_PW, db) });
    await c.connect();
    try {
      for (const s of sql) await c.query(s);
    } finally {
      await c.end();
    }
  };

  await admin('postgres', [
    `CREATE ROLE test_migrator LOGIN PASSWORD '${MIGRATOR_PW}'`,
    `CREATE ROLE test_app LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD '${APP_PW}'`,
    'CREATE DATABASE test_db OWNER test_migrator',
    'REVOKE ALL ON DATABASE test_db FROM PUBLIC',
    'GRANT CONNECT ON DATABASE test_db TO test_app',
  ]);
  await admin('test_db', [
    'GRANT USAGE ON SCHEMA public TO test_app',
    'ALTER DEFAULT PRIVILEGES FOR ROLE test_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO test_app',
    'ALTER DEFAULT PRIVILEGES FOR ROLE test_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO test_app',
  ]);

  return {
    migratorUrl: url('test_migrator', MIGRATOR_PW, 'test_db'),
    appUrl: url('test_app', APP_PW, 'test_db'),
    stop: async () => {
      await container.stop();
    },
    pause: async () => {
      execFileSync('docker', ['pause', id], { stdio: 'ignore' });
    },
    unpause: async () => {
      execFileSync('docker', ['unpause', id], { stdio: 'ignore' });
    },
  };
}
