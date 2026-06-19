import type { Logger } from 'pino';
import { query } from '../db/client.js';
import { loadEnv } from '../config/env.js';

const DEFAULT_BATCH_SIZE = 50_000;
const DEFAULT_WORKERS = 6;

type BlockTable = 'geo_city_blocks' | 'geo_country_blocks';
type MappingTable = 'geo_city_block_asn' | 'geo_country_block_asn';
type IdColumn = 'city_block_id' | 'country_block_id';

function resolveBatchSize(): number {
  const envBatch = Number(process.env.ASN_MAP_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(envBatch) || envBatch < 1_000) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.floor(envBatch), 100_000);
}

function resolveWorkerCount(): number {
  const envWorkers = Number(process.env.ASN_MAP_WORKERS ?? DEFAULT_WORKERS);
  if (!Number.isFinite(envWorkers) || envWorkers < 1) return DEFAULT_WORKERS;
  return Math.min(Math.floor(envWorkers), 8);
}

async function populateAsnMappingsForTable(
  blockTable: BlockTable,
  mappingTable: MappingTable,
  idColumn: IdColumn,
  workers: number,
  logger?: Logger,
): Promise<number> {
  await query(`TRUNCATE ${mappingTable}`);

  const shardTotals = await Promise.all(
    Array.from({ length: workers }, (_, shard) =>
      populateAsnShard(blockTable, mappingTable, idColumn, shard, workers, logger),
    ),
  );

  return shardTotals.reduce((sum, count) => sum + count, 0);
}

async function populateAsnShard(
  blockTable: BlockTable,
  mappingTable: MappingTable,
  idColumn: IdColumn,
  shard: number,
  workers: number,
  logger?: Logger,
): Promise<number> {
  const batchSize = resolveBatchSize();
  let lastId = 0;
  let total = 0;

  while (true) {
    const result = await query<{ count: number; max_id: number | null }>(
      `WITH batch AS (
         SELECT cb.id, cb.network
         FROM ${blockTable} cb
         WHERE cb.id > $1
           AND mod(cb.id, $3) = $4
         ORDER BY cb.id
         LIMIT $2
       ),
       inserted AS (
         INSERT INTO ${mappingTable} (${idColumn}, asn, asn_org)
         SELECT
           b.id,
           asn.asn,
           asn.asn_org
         FROM batch b
         LEFT JOIN LATERAL (
           SELECT
             ab.autonomous_system_number AS asn,
             ab.autonomous_system_organization AS asn_org
           FROM geo_asn_blocks ab
           WHERE ab.network >>= b.network
           ORDER BY masklen(ab.network) DESC
           LIMIT 1
         ) asn ON true
         RETURNING 1
       )
       SELECT
         (SELECT COUNT(*)::int FROM inserted) AS count,
         (SELECT MAX(id) FROM batch) AS max_id`,
      [lastId, batchSize, workers, shard],
    );

    const batchCount = result.rows[0]?.count ?? 0;
    const maxId = result.rows[0]?.max_id;
    if (batchCount === 0 || maxId == null) break;

    total += batchCount;
    lastId = maxId;
    logger?.debug(
      { blockTable, shard, workers, lastId, batchCount, total },
      'ASN mapping shard batch complete',
    );
  }

  logger?.info({ blockTable, shard, workers, total }, 'ASN mapping shard complete');
  return total;
}

/** Clear ASN mappings before staging truncate — FK follows table rename after swap. */
export async function clearBlockAsnMappings(): Promise<void> {
  await query('TRUNCATE geo_city_block_asn, geo_country_block_asn');
}

/** After table swap, FK constraints follow renamed tables — point back to production. */
export async function repointAsnMappingForeignKeys(): Promise<void> {
  await query(`
    ALTER TABLE geo_city_block_asn DROP CONSTRAINT IF EXISTS geo_city_block_asn_city_block_id_fkey;
    ALTER TABLE geo_country_block_asn DROP CONSTRAINT IF EXISTS geo_country_block_asn_country_block_id_fkey;
  `);

  const cityPk = await query<{ has_pk: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'geo_city_blocks'::regclass AND contype = 'p'
     ) AS has_pk`,
  );
  if (!cityPk.rows[0]?.has_pk) {
    await query(`
      ALTER TABLE geo_city_blocks ADD CONSTRAINT geo_city_blocks_pkey PRIMARY KEY (id);
    `);
  }

  const countryPk = await query<{ has_pk: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'geo_country_blocks'::regclass AND contype = 'p'
     ) AS has_pk`,
  );
  if (!countryPk.rows[0]?.has_pk) {
    await query(`
      ALTER TABLE geo_country_blocks ADD CONSTRAINT geo_country_blocks_pkey PRIMARY KEY (id);
    `);
  }

  await query(`
    ALTER TABLE geo_city_block_asn
      ADD CONSTRAINT geo_city_block_asn_city_block_id_fkey
      FOREIGN KEY (city_block_id) REFERENCES geo_city_blocks(id) ON DELETE CASCADE;
    ALTER TABLE geo_country_block_asn
      ADD CONSTRAINT geo_country_block_asn_country_block_id_fkey
      FOREIGN KEY (country_block_id) REFERENCES geo_country_blocks(id) ON DELETE CASCADE;
  `);
}

export async function ensureAsnMappingForeignKeys(): Promise<void> {
  const result = await query<{ ref: string }>(
    `SELECT confrelid::regclass::text AS ref
     FROM pg_constraint
     WHERE conname = 'geo_city_block_asn_city_block_id_fkey'`,
  );
  const ref = result.rows[0]?.ref ?? '';
  if (ref.startsWith('stg_')) {
    await repointAsnMappingForeignKeys();
  }
}

export async function populateBlockAsnMappings(logger?: Logger): Promise<{
  city: number;
  country: number;
}> {
  loadEnv();
  const workers = resolveWorkerCount();
  const batchSize = resolveBatchSize();
  logger?.info({ workers, batchSize }, 'Starting parallel ASN mapping populate');

  const [city, country] = await Promise.all([
    populateAsnMappingsForTable(
      'geo_city_blocks',
      'geo_city_block_asn',
      'city_block_id',
      workers,
      logger,
    ),
    populateAsnMappingsForTable(
      'geo_country_blocks',
      'geo_country_block_asn',
      'country_block_id',
      workers,
      logger,
    ),
  ]);

  return { city, country };
}
