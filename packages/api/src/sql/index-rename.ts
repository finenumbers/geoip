import { query } from '../db/client.js';
import { logger } from '../config/logger.js';

/** Production ↔ staging table pairs affected by rename swap. */
const PK_SWAP_PAIRS = [
  ['geo_city_blocks', 'stg_geo_city_blocks'],
  ['geo_country_blocks', 'stg_geo_country_blocks'],
  ['geo_asn_blocks', 'stg_geo_asn_blocks'],
  ['geo_city_locations', 'stg_geo_city_locations'],
  ['geo_country_locations', 'stg_geo_country_locations'],
] as const;

async function indexTable(indexName: string): Promise<string | null> {
  const result = await query<{ tablename: string }>(
    `SELECT tablename
     FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = $1`,
    [indexName],
  );
  return result.rows[0]?.tablename ?? null;
}

/**
 * After ALTER TABLE RENAME swap, PK indexes keep old names on new tables.
 * Swap names back so production has geo_*_pkey and staging has stg_*_pkey.
 */
export async function fixSwappedPrimaryKeyNames(): Promise<number> {
  let fixed = 0;

  for (const [prodTable, stgTable] of PK_SWAP_PAIRS) {
    const prodPk = `${prodTable}_pkey`;
    const stgPk = `${stgTable}_pkey`;
    const prodHasWrong = (await indexTable(stgPk)) === prodTable;
    const stgHasWrong = (await indexTable(prodPk)) === stgTable;

    if (!prodHasWrong && !stgHasWrong) continue;

    if (prodHasWrong && stgHasWrong) {
      const tmp = `${prodTable}_pkey_repair_tmp`;
      await query(`ALTER INDEX IF EXISTS ${prodPk} RENAME TO ${tmp}`);
      await query(`ALTER INDEX IF EXISTS ${stgPk} RENAME TO ${prodPk}`);
      await query(`ALTER INDEX IF EXISTS ${tmp} RENAME TO ${stgPk}`);
      fixed++;
      logger.info({ prodTable, stgTable }, 'Swapped misnamed primary key indexes');
      continue;
    }

    if (prodHasWrong) {
      await query(`ALTER INDEX IF EXISTS ${stgPk} RENAME TO ${prodPk}`);
      fixed++;
      logger.info({ prodTable, from: stgPk, to: prodPk }, 'Renamed production primary key index');
    }

    if (stgHasWrong) {
      await query(`ALTER INDEX IF EXISTS ${prodPk} RENAME TO ${stgPk}`);
      fixed++;
      logger.info({ stgTable, from: prodPk, to: stgPk }, 'Renamed staging primary key index');
    }
  }

  return fixed;
}

export async function hasMisnamedPrimaryKeys(): Promise<boolean> {
  for (const [prodTable, stgTable] of PK_SWAP_PAIRS) {
    const prodPk = `${prodTable}_pkey`;
    const stgPk = `${stgTable}_pkey`;
    if ((await indexTable(stgPk)) === prodTable) return true;
    if ((await indexTable(prodPk)) === stgTable) return true;
  }
  return false;
}
