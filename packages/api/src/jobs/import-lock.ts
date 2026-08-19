import pg from 'pg';
import { IMPORT_LOCK_KEY } from '@geoip/shared';
import { loadEnv } from '../config/env.js';

let lockClient: pg.Client | null = null;

function directDatabaseUrl(): string {
  const env = loadEnv();
  return env.DATABASE_DIRECT_URL ?? env.DATABASE_URL;
}

async function getLockClient(): Promise<pg.Client> {
  if (!lockClient) {
    lockClient = new pg.Client({ connectionString: directDatabaseUrl() });
    await lockClient.connect();
  }
  return lockClient;
}

/** Session-scoped import lock via direct Postgres (not pgbouncer transaction pool). */
export async function tryAcquireImportLock(): Promise<boolean> {
  const client = await getLockClient();
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
    [IMPORT_LOCK_KEY],
  );
  return result.rows[0]?.acquired ?? false;
}

export async function releaseImportLock(): Promise<void> {
  if (!lockClient) return;
  try {
    await lockClient.query('SELECT pg_advisory_unlock($1::bigint)', [IMPORT_LOCK_KEY]);
  } catch {
    // ignore unlock errors during shutdown
  }
  await lockClient.end().catch(() => undefined);
  lockClient = null;
}

/**
 * Probe whether the GRChC import advisory lock is free using a fresh session.
 * Must not use the singleton lockClient (re-entrant try_lock would lie).
 */
export async function isImportLockFree(): Promise<boolean> {
  const client = new pg.Client({ connectionString: directDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [IMPORT_LOCK_KEY],
    );
    const acquired = result.rows[0]?.acquired ?? false;
    if (acquired) {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [IMPORT_LOCK_KEY]);
    }
    return acquired;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Run `fn` while holding the import advisory lock on a fresh session.
 * If the lock is held by another session, returns null without calling `fn`.
 */
export async function withImportLockIfFree<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = new pg.Client({ connectionString: directDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [IMPORT_LOCK_KEY],
    );
    if (!(result.rows[0]?.acquired ?? false)) {
      return null;
    }
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [IMPORT_LOCK_KEY]);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Release orphaned import lock left by a crashed worker session. */
export async function releaseOrphanedImportLock(): Promise<void> {
  const client = new pg.Client({ connectionString: directDatabaseUrl() });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [IMPORT_LOCK_KEY]);
  } finally {
    await client.end().catch(() => undefined);
  }
}
