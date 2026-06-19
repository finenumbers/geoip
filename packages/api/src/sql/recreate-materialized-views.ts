import type pg from 'pg';
import { eq } from 'drizzle-orm';
import {
  query,
  getDirectPool,
  withDirectPoolClient,
  resetPoolClientSession,
} from '../db/client.js';
import { getDb } from '../db/client.js';
import { datasetState } from '../db/schema.js';
import { logger } from '../config/logger.js';
import { materializedViewsHaveSortRanks } from './mv-rank-columns.js';
import { invalidateDatasetStateCache } from '../repositories/dataset-repository.js';
import { invalidateReadyCache } from '../services/ready-cache.js';

const CITY_MV_BASE = `
  SELECT
    cb.id,
    cb.network::text AS network,
    family(cb.network) AS ip_family,
    masklen(cb.network) AS prefix_len,
    cb.geoname_id,
    cl.continent_name,
    cl.country_iso_code,
    cl.country_name,
    cl.subdivision_1_name,
    cl.subdivision_2_name,
    cl.city_name,
    cl.timezone,
    cb.latitude,
    cb.longitude,
    cb.accuracy_radius,
    cb.postal_code,
    NULL::integer AS asn,
    NULL::text AS asn_org
  FROM geo_city_blocks cb
  LEFT JOIN geo_city_locations cl ON cl.geoname_id = cb.geoname_id
`;

const CITY_MV_SQL = `
  CREATE MATERIALIZED VIEW mv_city_blocks_analytics AS
  WITH base AS (${CITY_MV_BASE})
  SELECT
    base.*,
    DENSE_RANK() OVER (ORDER BY base.country_name DESC NULLS LAST)::integer AS country_name_rank,
    DENSE_RANK() OVER (ORDER BY base.city_name ASC NULLS LAST)::integer AS city_name_rank
  FROM base
`;

const COUNTRY_MV_SQL = `
  CREATE MATERIALIZED VIEW mv_country_blocks_analytics AS
  SELECT
    cb.id,
    cb.network::text AS network,
    family(cb.network) AS ip_family,
    masklen(cb.network) AS prefix_len,
    cb.geoname_id,
    cl.continent_name,
    cl.country_iso_code,
    cl.country_name,
    cl.subdivision_1_name,
    cl.subdivision_2_name,
    NULL::integer AS asn,
    NULL::text AS asn_org
  FROM geo_country_blocks cb
  LEFT JOIN geo_country_locations cl ON cl.geoname_id = cb.geoname_id
`;

const RU_MV_SQL = `
  CREATE MATERIALIZED VIEW mv_city_blocks_ru AS
  WITH base AS (
    ${CITY_MV_BASE}
    WHERE cl.country_iso_code = 'RU'
  )
  SELECT
    base.*,
    DENSE_RANK() OVER (ORDER BY base.country_name DESC NULLS LAST)::integer AS country_name_rank,
    DENSE_RANK() OVER (ORDER BY base.city_name ASC NULLS LAST)::integer AS city_name_rank
  FROM base
`;

export async function materializedViewsExist(): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_matviews
       WHERE schemaname = 'public' AND matviewname = 'mv_city_blocks_analytics'
     ) AS exists`,
  );
  return result.rows[0]?.exists ?? false;
}

async function mvReferencesStaging(): Promise<boolean> {
  const result = await query<{ uses_staging: boolean }>(
    `SELECT pg_get_viewdef('mv_city_blocks_analytics'::regclass, true) LIKE '%stg_geo_%' AS uses_staging`,
  );
  return result.rows[0]?.uses_staging ?? false;
}

async function dropMaterializedViews(): Promise<void> {
  await query('DROP MATERIALIZED VIEW IF EXISTS mv_city_blocks_ru');
  await query('DROP MATERIALIZED VIEW IF EXISTS mv_city_blocks_analytics');
  await query('DROP MATERIALIZED VIEW IF EXISTS mv_country_blocks_analytics');
}

async function execOnConnection(sql: string): Promise<void> {
  const client = await getDirectPool().connect();
  try {
    await client.query('SET statement_timeout = 0');
    await client.query(sql);
  } finally {
    await resetPoolClientSession(client);
    client.release();
  }
}

async function setMvOperationalStatus(
  status: 'ready' | 'refreshing' | 'unavailable',
  refreshedAt?: Date,
): Promise<void> {
  const db = getDb();
  await db
    .update(datasetState)
    .set({
      mvStatus: status,
      ...(refreshedAt ? { mvRefreshedAt: refreshedAt } : {}),
    })
    .where(eq(datasetState.id, 1));
  invalidateDatasetStateCache();
  invalidateReadyCache();
}

async function createMaterializedViews(): Promise<void> {
  await Promise.all([
    execOnConnection(CITY_MV_SQL),
    execOnConnection(COUNTRY_MV_SQL),
    execOnConnection(RU_MV_SQL),
  ]);
}

async function createMaterializedViewIndexes(): Promise<void> {
  await Promise.all([
    execOnConnection(`
      CREATE UNIQUE INDEX mv_city_blocks_analytics_id_idx ON mv_city_blocks_analytics (id);
      CREATE INDEX mv_city_blocks_analytics_country_idx ON mv_city_blocks_analytics (country_iso_code);
      CREATE INDEX mv_city_blocks_analytics_network_idx ON mv_city_blocks_analytics (network);
      CREATE INDEX mv_city_blocks_analytics_country_name_rank_id_idx
        ON mv_city_blocks_analytics (country_name_rank ASC, id ASC);
      CREATE INDEX mv_city_blocks_analytics_city_name_rank_id_idx
        ON mv_city_blocks_analytics (city_name_rank ASC, id ASC);
    `),
    execOnConnection(`
      CREATE UNIQUE INDEX mv_country_blocks_analytics_id_idx ON mv_country_blocks_analytics (id);
      CREATE INDEX mv_country_blocks_analytics_country_idx ON mv_country_blocks_analytics (country_iso_code);
      CREATE INDEX mv_country_blocks_analytics_network_idx ON mv_country_blocks_analytics (network);
    `),
    execOnConnection(`
      CREATE UNIQUE INDEX mv_city_blocks_ru_id_idx ON mv_city_blocks_ru (id);
      CREATE INDEX mv_city_blocks_ru_network_idx ON mv_city_blocks_ru (network);
      CREATE INDEX mv_city_blocks_ru_country_name_rank_id_idx
        ON mv_city_blocks_ru (country_name_rank ASC, id ASC);
      CREATE INDEX mv_city_blocks_ru_city_name_rank_id_idx
        ON mv_city_blocks_ru (city_name_rank ASC, id ASC);
    `),
  ]);
}

/** After table rename swap, MV OIDs point at staging tables — recreate from geo_* production tables. */
export async function recreateMaterializedViewsFromProduction(): Promise<void> {
  logger.info('Recreating materialized views from production tables');
  await withDirectPoolClient(async (client) => {
    await dropMaterializedViewsOnClient(client);
    await createMaterializedViewsOnClient(client);
    await createMaterializedViewIndexesOnClient(client);
    await client.query('ANALYZE mv_city_blocks_analytics, mv_country_blocks_analytics, mv_city_blocks_ru');
  });
}

async function dropMaterializedViewsOnClient(client: pg.PoolClient): Promise<void> {
  await client.query('DROP MATERIALIZED VIEW IF EXISTS mv_city_blocks_ru');
  await client.query('DROP MATERIALIZED VIEW IF EXISTS mv_city_blocks_analytics');
  await client.query('DROP MATERIALIZED VIEW IF EXISTS mv_country_blocks_analytics');
}

async function createMaterializedViewsOnClient(client: pg.PoolClient): Promise<void> {
  await client.query(CITY_MV_SQL);
  await client.query(COUNTRY_MV_SQL);
  await client.query(RU_MV_SQL);
}

async function createMaterializedViewIndexesOnClient(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE UNIQUE INDEX mv_city_blocks_analytics_id_idx ON mv_city_blocks_analytics (id);
    CREATE INDEX mv_city_blocks_analytics_country_idx ON mv_city_blocks_analytics (country_iso_code);
    CREATE INDEX mv_city_blocks_analytics_network_idx ON mv_city_blocks_analytics (network);
    CREATE INDEX mv_city_blocks_analytics_country_name_rank_id_idx
      ON mv_city_blocks_analytics (country_name_rank ASC, id ASC);
    CREATE INDEX mv_city_blocks_analytics_city_name_rank_id_idx
      ON mv_city_blocks_analytics (city_name_rank ASC, id ASC);
  `);
  await client.query(`
    CREATE UNIQUE INDEX mv_country_blocks_analytics_id_idx ON mv_country_blocks_analytics (id);
    CREATE INDEX mv_country_blocks_analytics_country_idx ON mv_country_blocks_analytics (country_iso_code);
    CREATE INDEX mv_country_blocks_analytics_network_idx ON mv_country_blocks_analytics (network);
  `);
  await client.query(`
    CREATE UNIQUE INDEX mv_city_blocks_ru_id_idx ON mv_city_blocks_ru (id);
    CREATE INDEX mv_city_blocks_ru_network_idx ON mv_city_blocks_ru (network);
    CREATE INDEX mv_city_blocks_ru_country_name_rank_id_idx
      ON mv_city_blocks_ru (country_name_rank ASC, id ASC);
    CREATE INDEX mv_city_blocks_ru_city_name_rank_id_idx
      ON mv_city_blocks_ru (city_name_rank ASC, id ASC);
  `);
}

export async function ensureMaterializedViewsOnProduction(): Promise<boolean> {
  if (!(await materializedViewsExist())) {
    return false;
  }
  return !(await mvReferencesStaging());
}

export async function materializedViewsNeedRecreate(): Promise<boolean> {
  if (!(await ensureMaterializedViewsOnProduction())) {
    return true;
  }
  return !(await materializedViewsHaveSortRanks());
}

/** True when browse/export SQL can safely query materialized views. */
export async function isMaterializedViewsReadyForQueries(): Promise<boolean> {
  const { getDatasetState } = await import('../repositories/dataset-repository.js');
  const state = await getDatasetState();
  if (state.mvStatus !== 'ready') return false;
  return materializedViewsExist();
}

export function recreateMaterializedViewsInBackground(): void {
  void (async () => {
    if (!(await materializedViewsNeedRecreate())) {
      return;
    }
    logger.warn('Materialized views need recreate — running in background');
    await setMvOperationalStatus('refreshing');
    try {
      await recreateMaterializedViewsFromProduction();
      await setMvOperationalStatus('ready', new Date());
      logger.info('Background materialized view recreate complete');
    } catch (err) {
      await setMvOperationalStatus('unavailable');
      logger.error({ err }, 'Background materialized view recreate failed');
    }
  })();
}

export async function refreshOrRecreateMaterializedViews(): Promise<void> {
  await withDirectPoolClient(async (client) => {
      if (!(await materializedViewsExist()) || (await mvReferencesStaging())) {
        await dropMaterializedViewsOnClient(client);
        await createMaterializedViewsOnClient(client);
        await createMaterializedViewIndexesOnClient(client);
        await client.query('ANALYZE mv_city_blocks_analytics, mv_country_blocks_analytics, mv_city_blocks_ru');
        return;
      }

      try {
        await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_city_blocks_analytics');
        await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_country_blocks_analytics');
        await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_city_blocks_ru');
      } catch {
        logger.warn('CONCURRENTLY refresh failed, recreating materialized views');
        await dropMaterializedViewsOnClient(client);
        await createMaterializedViewsOnClient(client);
        await createMaterializedViewIndexesOnClient(client);
        await client.query('ANALYZE mv_city_blocks_analytics, mv_country_blocks_analytics, mv_city_blocks_ru');
        return;
      }

      await client.query('ANALYZE mv_city_blocks_analytics, mv_country_blocks_analytics, mv_city_blocks_ru');
  });
}
