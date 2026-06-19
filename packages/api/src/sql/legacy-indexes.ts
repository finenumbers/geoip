import { query } from '../db/client.js';
import { logger } from '../config/logger.js';

const LEGACY_BTREE_INDEXES = [
  'stg_geo_city_blocks_network_idx',
  'stg_geo_country_blocks_network_idx',
  'stg_geo_asn_blocks_network_idx',
] as const;

/** Drop orphaned staging btree indexes that remain attached to production tables after swap. */
export async function cleanupLegacyBtreeIndexes(): Promise<number> {
  let dropped = 0;
  for (const indexName of LEGACY_BTREE_INDEXES) {
    const exists = await query<{ regclass: string | null }>(
      `SELECT to_regclass('public.${indexName}')::text AS regclass`,
    );
    if (!exists.rows[0]?.regclass) continue;
    await query(`DROP INDEX IF EXISTS ${indexName}`);
    logger.info({ indexName }, 'Dropped legacy btree index');
    dropped++;
  }
  return dropped;
}
