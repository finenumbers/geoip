import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { loadEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

let pool: pg.Pool | null = null;
let directPool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function usesPgbouncer(connectionString: string): boolean {
  try {
    return new URL(connectionString).port === '6432';
  } catch {
    return connectionString.includes(':6432');
  }
}

function appendPgOptions(connectionString: string, option: string): string {
  const url = new URL(connectionString);
  const existing = url.searchParams.get('options');
  url.searchParams.set('options', existing ? `${existing} ${option}` : option);
  return url.toString();
}

/** Idle client errors (e.g. Postgres stop) must be handled or node-postgres can crash the process. */
function attachPoolErrorHandler(next: pg.Pool, label: string): pg.Pool {
  next.on('error', (err) => {
    logger.error({ err, pool: label }, 'Unexpected idle Postgres client error');
  });
  return next;
}

export function getPool(): pg.Pool {
  if (!pool) {
    const env = loadEnv();
    const viaPgbouncer = usesPgbouncer(env.DATABASE_URL);
    pool = attachPoolErrorHandler(
      new pg.Pool({
        connectionString: viaPgbouncer
          ? env.DATABASE_URL
          : appendPgOptions(
              env.DATABASE_URL,
              `-c statement_timeout=${env.STATEMENT_TIMEOUT_MS}`,
            ),
        max: env.DATABASE_POOL_MAX,
        idleTimeoutMillis: 30_000,
      }),
      'app',
    );
  }
  return pool;
}

/** Direct Postgres pool — bypasses PgBouncer for long DDL (MV recreate, migrations). */
export function getDirectPool(): pg.Pool {
  if (!directPool) {
    const env = loadEnv();
    directPool = attachPoolErrorHandler(
      new pg.Pool({
        connectionString: appendPgOptions(
          env.DATABASE_DIRECT_URL ?? env.DATABASE_URL,
          '-c statement_timeout=0',
        ),
        max: 2,
        idleTimeoutMillis: 30_000,
      }),
      'direct',
    );
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
