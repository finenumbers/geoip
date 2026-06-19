import { query } from '../db/client.js';
import { logger } from '../config/logger.js';

const STAGING_BLOCK_TABLES = [
  'stg_geo_city_blocks',
  'stg_geo_country_blocks',
  'stg_geo_asn_blocks',
] as const;

/** Remove production-grade indexes from staging block tables after swap — COPY only needs heap. */
export async function stripStagingBlockIndexes(): Promise<number> {
  let dropped = 0;

  for (const table of STAGING_BLOCK_TABLES) {
    const constraints = await query<{ conname: string }>(
      `SELECT conname
       FROM pg_constraint
       WHERE conrelid = $1::regclass
         AND contype IN ('u', 'f')`,
      [table],
    );

    for (const row of constraints.rows) {
      await query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${row.conname}`);
      dropped++;
    }

    const indexes = await query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = $1
         AND indexname NOT LIKE '%_pkey'`,
      [table],
    );

    for (const row of indexes.rows) {
      await query(`DROP INDEX IF EXISTS ${row.indexname}`);
      dropped++;
    }
  }

  if (dropped > 0) {
    logger.info({ dropped }, 'Stripped staging block indexes');
  }

  return dropped;
}

export async function getStagingBlockIndexBytes(): Promise<number> {
  const result = await query<{ bytes: number }>(
    `SELECT COALESCE(SUM(pg_relation_size(indexrelid)), 0)::bigint AS bytes
     FROM pg_stat_user_indexes
     WHERE schemaname = 'public'
       AND relname = ANY($1::text[])`,
    [STAGING_BLOCK_TABLES as unknown as string[]],
  );
  return Number(result.rows[0]?.bytes ?? 0);
}
