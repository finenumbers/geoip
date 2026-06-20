import type pg from 'pg';
import { query, withPoolClient } from '../db/client.js';
import { logger } from '../config/logger.js';
import { cleanupLegacyBtreeIndexes } from './legacy-indexes.js';
import { ensureAsnMappingForeignKeys } from './asn-mapping.js';
import { fixSwappedPrimaryKeyNames, hasMisnamedPrimaryKeys } from './index-rename.js';
import { getStagingBlockIndexBytes, stripStagingBlockIndexes } from './staging-indexes.js';
import { refreshOrRecreateMaterializedViews, recreateMaterializedViewsFromProduction, ensureMaterializedViewsOnProduction, recreateMaterializedViewsInBackground, materializedViewsNeedRecreate } from './recreate-materialized-views.js';

const BLOCK_TABLES = ['geo_city_blocks', 'geo_country_blocks', 'geo_asn_blocks'] as const;

const SWAP_TABLES = [
  ['geo_city_locations', 'stg_geo_city_locations'],
  ['geo_country_locations', 'stg_geo_country_locations'],
  ['geo_city_blocks', 'stg_geo_city_blocks'],
  ['geo_country_blocks', 'stg_geo_country_blocks'],
  ['geo_asn_blocks', 'stg_geo_asn_blocks'],
] as const;

export async function truncateStaging(): Promise<void> {
  await ensureAsnMappingForeignKeys();
  await query(
    'TRUNCATE geo_city_block_asn, geo_country_block_asn, stg_geo_city_locations, stg_geo_country_locations, stg_geo_city_blocks, stg_geo_country_blocks, stg_geo_asn_blocks RESTART IDENTITY',
  );
  await relaxStagingBlockForeignKeys();
}

/** Staging blocks inherit FK after swap; drop before COPY because ZIP entries are blocks-before-locations. */
export async function relaxStagingBlockForeignKeys(): Promise<void> {
  await query(`
    ALTER TABLE stg_geo_city_blocks DROP CONSTRAINT IF EXISTS geo_city_blocks_geoname_id_fkey;
    ALTER TABLE stg_geo_country_blocks DROP CONSTRAINT IF EXISTS geo_country_blocks_geoname_id_fkey;
  `);
}

export async function swapStagingToProduction(): Promise<void> {
  const client = await import('../db/client.js').then((m) => m.getPool().connect());
  try {
    await client.query('BEGIN');
    for (const [prod, stg] of SWAP_TABLES) {
      await client.query(`ALTER TABLE ${prod} RENAME TO ${prod}_old`);
      await client.query(`ALTER TABLE ${stg} RENAME TO ${prod}`);
      await client.query(`ALTER TABLE ${prod}_old RENAME TO ${stg}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dropOldStagingData(): Promise<void> {
  await truncateStaging();
  await stripStagingBlockIndexes();
  await fixSwappedPrimaryKeyNames();
}

const INDEX_REBUILD_LOCK = 0x47454f495031; // 'GEOIP1' — serialize index rebuild across processes

async function indexOnTable(indexName: string): Promise<string | null> {
  const result = await query<{ tablename: string }>(
    `SELECT tablename
     FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = $1`,
    [indexName],
  );
  return result.rows[0]?.tablename ?? null;
}

async function productionIndexesOk(): Promise<boolean> {
  for (const table of BLOCK_TABLES) {
    const spgistName = `${table}_network_spgist`;
    const uniqueName = `${table}_network_key`;
    if ((await indexOnTable(spgistName)) !== table) return false;
    if ((await indexOnTable(uniqueName)) !== table) return false;
  }
  return true;
}

/** Rebuild SP-GiST/UNIQUE indexes on production block tables after staging swap. */
export async function rebuildProductionIndexes(): Promise<void> {
  await withPoolClient(
    async (client) => {
      await client.query('SELECT pg_advisory_lock($1)', [INDEX_REBUILD_LOCK]);
      try {
        if (await productionIndexesOk()) {
          logger.info('Production block indexes already valid');
          return;
        }

        for (const table of BLOCK_TABLES) {
          await ensureSpgistIndexOnClient(client, table);
          await ensureUniqueNetworkIndexOnClient(client, table);
        }

        await client.query('ANALYZE geo_city_blocks, geo_country_blocks, geo_asn_blocks');
        await cleanupLegacyBtreeIndexes();
        logger.info('Production block indexes rebuilt');
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [INDEX_REBUILD_LOCK]);
      }
    },
    { unlimitedStatementTimeout: true },
  );
}

async function ensureSpgistIndexOnClient(client: pg.PoolClient, table: string): Promise<void> {
  const spgistName = `${table}_network_spgist`;
  const attachedTo = await indexOnTable(spgistName);
  if (attachedTo === table) {
    logger.info({ table, spgistName }, 'SP-GiST index already on production table');
    return;
  }

  if (attachedTo != null) {
    logger.info({ spgistName, attachedTo, table }, 'Dropping misplaced SP-GiST index');
    await client.query(`DROP INDEX IF EXISTS ${spgistName}`);
  }

  logger.info({ table, spgistName }, 'Creating SP-GiST index on production table');
  await client.query(`CREATE INDEX ${spgistName} ON ${table} USING spgist (network)`);
}

async function ensureUniqueNetworkIndexOnClient(client: pg.PoolClient, table: string): Promise<void> {
  const uniqueName = `${table}_network_key`;
  const attachedTo = await indexOnTable(uniqueName);
  if (attachedTo === table) {
    logger.info({ table, uniqueName }, 'UNIQUE network index already on production table');
    return;
  }

  if (attachedTo != null) {
    logger.info({ uniqueName, attachedTo, table }, 'Dropping misplaced UNIQUE network index');
    await client.query(`ALTER TABLE ${attachedTo} DROP CONSTRAINT IF EXISTS ${uniqueName}`);
    await client.query(`DROP INDEX IF EXISTS ${uniqueName}`);
  }

  logger.info({ table, uniqueName }, 'Creating UNIQUE network index on production table');
  await client.query(`CREATE UNIQUE INDEX ${uniqueName} ON ${table} (network)`);
}

/** One-time / startup guard: fix indexes after swap if they landed on staging. */
export async function ensureProductionIndexes(options?: { deferMvRecreate?: boolean }): Promise<void> {
  await ensureAsnMappingForeignKeys();

  if (await hasMisnamedPrimaryKeys()) {
    logger.warn('Misnamed primary key indexes detected — repairing');
    await fixSwappedPrimaryKeyNames();
  }

  const stagingIndexBytes = await getStagingBlockIndexBytes();
  if (stagingIndexBytes > 0) {
    logger.info({ stagingIndexBytes }, 'Stripping stale staging block indexes on startup');
    await stripStagingBlockIndexes();
  }

  if (await productionIndexesOk()) {
    await cleanupLegacyBtreeIndexes();
  } else {
    logger.warn('Production indexes need rebuild');
    await rebuildProductionIndexes();
  }

  if (await materializedViewsNeedRecreate()) {
    if (options?.deferMvRecreate) {
      logger.warn('Materialized views need recreate — deferred to background');
      return;
    }
    if (!(await ensureMaterializedViewsOnProduction())) {
      logger.warn('Materialized views reference staging tables — recreating from production');
    } else {
      logger.warn('Materialized views missing sort rank columns — recreating from production');
    }
    await recreateMaterializedViewsFromProduction();
  }
}

export { recreateMaterializedViewsInBackground };

export { productionIndexesOk };

export async function refreshMaterializedViews(): Promise<void> {
  await refreshOrRecreateMaterializedViews();
}

export async function getMaterializedViewCounts(): Promise<{ city: number; country: number }> {
  const city = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM mv_city_blocks_analytics');
  const country = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM mv_country_blocks_analytics');
  return {
    city: city.rows[0]?.count ?? 0,
    country: country.rows[0]?.count ?? 0,
  };
}

export async function validateStagingData(): Promise<{
  valid: boolean;
  errors: string[];
  counts: Record<string, number>;
}> {
  const errors: string[] = [];
  const counts: Record<string, number> = {};

  const tables = [
    'stg_geo_city_locations',
    'stg_geo_country_locations',
    'stg_geo_city_blocks',
    'stg_geo_country_blocks',
    'stg_geo_asn_blocks',
  ];

  for (const table of tables) {
    const result = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0]?.count ?? 0;
    if (counts[table] === 0) {
      errors.push(`${table} is empty`);
    }
  }

  const orphanCity = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM stg_geo_city_blocks cb
     LEFT JOIN stg_geo_city_locations cl ON cl.geoname_id = cb.geoname_id
     WHERE cl.geoname_id IS NULL`,
  );
  if ((orphanCity.rows[0]?.count ?? 0) > 0) {
    errors.push(`Found ${orphanCity.rows[0]?.count} city blocks with missing locations`);
  }

  const orphanCountry = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM stg_geo_country_blocks cb
     LEFT JOIN stg_geo_country_locations cl ON cl.geoname_id = cb.geoname_id
     WHERE cl.geoname_id IS NULL`,
  );
  if ((orphanCountry.rows[0]?.count ?? 0) > 0) {
    errors.push(`Found ${orphanCountry.rows[0]?.count} country blocks with missing locations`);
  }

  const dupCity = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM (
       SELECT network FROM stg_geo_city_blocks GROUP BY network HAVING COUNT(*) > 1
     ) d`,
  );
  if ((dupCity.rows[0]?.count ?? 0) > 0) {
    errors.push(`Found duplicate networks in city blocks`);
  }

  const dupCountry = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM (
       SELECT network FROM stg_geo_country_blocks GROUP BY network HAVING COUNT(*) > 1
     ) d`,
  );
  if ((dupCountry.rows[0]?.count ?? 0) > 0) {
    errors.push(`Found duplicate networks in country blocks`);
  }

  const dupAsn = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM (
       SELECT network FROM stg_geo_asn_blocks GROUP BY network HAVING COUNT(*) > 1
     ) d`,
  );
  if ((dupAsn.rows[0]?.count ?? 0) > 0) {
    errors.push(`Found duplicate networks in ASN blocks`);
  }

  const nonRuCity = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM stg_geo_city_locations WHERE locale_code != 'ru'`,
  );
  if ((nonRuCity.rows[0]?.count ?? 0) > 0) {
    errors.push(`Non-RU locale found in city locations`);
  }

  return { valid: errors.length === 0, errors, counts };
}
