import pg from 'pg';
import { RIR_IMPORT_LOCK_KEY } from '@geoip/shared';
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

export async function tryAcquireRirImportLock(): Promise<boolean> {
  const client = await getLockClient();
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS acquired',
    [RIR_IMPORT_LOCK_KEY],
  );
  return result.rows[0]?.acquired ?? false;
}

export async function releaseRirImportLock(): Promise<void> {
  if (!lockClient) return;
  try {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [RIR_IMPORT_LOCK_KEY]);
  } catch {
    // ignore unlock errors during shutdown
  }
  await lockClient.end().catch(() => undefined);
  lockClient = null;
}

export async function releaseOrphanedRirImportLock(): Promise<void> {
  const client = new pg.Client({ connectionString: directDatabaseUrl() });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [RIR_IMPORT_LOCK_KEY]);
  } finally {
    await client.end().catch(() => undefined);
  }
}
