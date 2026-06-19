import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(): Promise<void> {
  const env = loadEnv();
  const client = new pg.Client({
    connectionString: env.DATABASE_DIRECT_URL ?? env.DATABASE_URL,
  });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query('SELECT pg_advisory_lock($1)', [0x47454f495032]); // GEOIP2 — serialize migrations

    const migrationsDir = join(__dirname, '../../migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [file],
      );
      if (rows.length > 0) continue;

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      logger.info({ migration: file }, 'Applying migration');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    logger.info('Migrations complete');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [0x47454f495032]).catch(() => {});
    await client.end();
  }
}

import { pathToFileURL } from 'node:url';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  migrate().catch((err) => {
    logger.error(err, 'Migration failed');
    process.exit(1);
  });
}
