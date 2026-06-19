import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { loadEnv } from '../config/env.js';

let pool: pg.Pool | null = null;
let directPool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
    });
    pool.on('connect', (client) => {
      void client.query(`SET statement_timeout = ${env.STATEMENT_TIMEOUT_MS}`);
    });
  }
  return pool;
}

/** Direct Postgres pool — bypasses PgBouncer for long DDL (MV recreate, migrations). */
export function getDirectPool(): pg.Pool {
  if (!directPool) {
    const env = loadEnv();
    directPool = new pg.Pool({
      connectionString: env.DATABASE_DIRECT_URL ?? env.DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 30_000,
    });
    directPool.on('connect', (client) => {
      void client.query('SET statement_timeout = 0');
    });
  }
  return directPool;
}

export function getDb() {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (directPool) {
    await directPool.end();
    directPool = null;
  }
  db = null;
}

/** Clears session overrides (e.g. statement_timeout) before returning a connection to the pool. */
export async function resetPoolClientSession(client: pg.PoolClient): Promise<void> {
  try {
    await client.query('RESET statement_timeout');
  } catch {
    // connection may already be broken
  }
}

/**
 * Runs work on a dedicated pool connection. When unlimitedStatementTimeout is set,
 * resets statement_timeout before release so other handlers are not affected.
 */
export async function withDirectPoolClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getDirectPool().connect();
  try {
    await client.query('SET statement_timeout = 0');
    return await fn(client);
  } finally {
    await resetPoolClientSession(client);
    client.release();
  }
}

export async function withPoolClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  options?: { unlimitedStatementTimeout?: boolean },
): Promise<T> {
  const client = await getPool().connect();
  try {
    if (options?.unlimitedStatementTimeout) {
      await client.query('SET statement_timeout = 0');
    }
    return await fn(client);
  } finally {
    if (options?.unlimitedStatementTimeout) {
      await resetPoolClientSession(client);
    }
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}
