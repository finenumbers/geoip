import { and, eq } from 'drizzle-orm';
import { getDb, query } from '../db/client.js';
import { datasetState, importRunSteps } from '../db/schema.js';
import { invalidateDatasetStateCache } from '../repositories/dataset-repository.js';
import { logger } from '../config/logger.js';
import { parseFilterCountCache } from './filter-count-cache.js';
import {
  ADDRESS_SPACE_COUNT_SQL,
  ipv4CountLooksInflated,
} from './unique-ipv4-coverage.js';

export type DatasetVolumeSnapshot = {
  asnBlocks: number;
  cityLocations: number;
  countryLocations: number;
  ruCityBlocks: number;
  datasetFingerprint: string | null;
  ipv4Addresses: string;
  ipv6Addresses: string;
};

export { ADDRESS_SPACE_COUNT_SQL };

let backfillRunning = false;

export function parseFingerprintFromDiscoverMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const match = message.match(/fp=([a-f0-9]+)/i);
  return match?.[1] ?? null;
}

export function datasetVolumesNeedBackfill(state: {
  mvStatus: string;
  cityRowCount: number;
  asnBlocksCount: number;
  cityLocationsCount: number;
  countryLocationsCount: number;
  ruCityBlocksCount: number;
  datasetFingerprint: string | null;
  ipv4AddressCount: string | number;
}): boolean {
  if (state.mvStatus !== 'ready' || state.cityRowCount <= 0) {
    return false;
  }

  const ipv4 = String(state.ipv4AddressCount ?? '0');

  return (
    state.asnBlocksCount === 0 ||
    state.cityLocationsCount === 0 ||
    state.countryLocationsCount === 0 ||
    state.ruCityBlocksCount === 0 ||
    state.datasetFingerprint == null ||
    ipv4 === '0' ||
    ipv4CountLooksInflated(ipv4)
  );
}

async function resolveFingerprint(activeImportRunId: string | null): Promise<string | null> {
  if (!activeImportRunId) return null;

  const db = getDb();
  const [step] = await db
    .select({ message: importRunSteps.message })
    .from(importRunSteps)
    .where(
      and(
        eq(importRunSteps.importRunId, activeImportRunId),
        eq(importRunSteps.name, 'discover_date'),
      ),
    )
    .limit(1);

  return parseFingerprintFromDiscoverMessage(step?.message);
}

async function countRuCityBlocks(filterCountCacheJson: unknown): Promise<number> {
  const cache = parseFilterCountCache(filterCountCacheJson);
  const fromCache = cache.city.country_iso_code?.RU;
  if (fromCache != null && fromCache > 0) {
    return fromCache;
  }

  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::bigint AS count
     FROM geo_city_blocks cb
     JOIN geo_city_locations cl ON cl.geoname_id = cb.geoname_id
     WHERE cl.country_iso_code = 'RU'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function computeDatasetVolumeSnapshot(
  activeImportRunId: string | null,
  filterCountCacheJson: unknown,
): Promise<DatasetVolumeSnapshot> {
  const counts = await query<{
    asn_blocks: number;
    city_locations: number;
    country_locations: number;
  }>(
    `SELECT
       (SELECT COUNT(*)::bigint FROM geo_asn_blocks) AS asn_blocks,
       (SELECT COUNT(*)::bigint FROM geo_city_locations) AS city_locations,
       (SELECT COUNT(*)::bigint FROM geo_country_locations) AS country_locations`,
  );

  const row = counts.rows[0];
  const ruCityBlocks = await countRuCityBlocks(filterCountCacheJson);
  const datasetFingerprint = await resolveFingerprint(activeImportRunId);
  const addressSpace = await query<{ ipv4_addresses: string; ipv6_addresses: string }>(
    ADDRESS_SPACE_COUNT_SQL,
  );
  const addressRow = addressSpace.rows[0];

  return {
    asnBlocks: Number(row?.asn_blocks ?? 0),
    cityLocations: Number(row?.city_locations ?? 0),
    countryLocations: Number(row?.country_locations ?? 0),
    ruCityBlocks,
    datasetFingerprint,
    ipv4Addresses: addressRow?.ipv4_addresses ?? '0',
    ipv6Addresses: addressRow?.ipv6_addresses ?? '0',
  };
}

export async function backfillDatasetVolumes(): Promise<DatasetVolumeSnapshot | null> {
  const db = getDb();
  const [state] = await db.select().from(datasetState).where(eq(datasetState.id, 1)).limit(1);
  if (!state || !datasetVolumesNeedBackfill(state)) {
    return null;
  }

  const snapshot = await computeDatasetVolumeSnapshot(
    state.activeImportRunId,
    state.filterCountCache,
  );

  await db
    .update(datasetState)
    .set({
      asnBlocksCount: snapshot.asnBlocks,
      cityLocationsCount: snapshot.cityLocations,
      countryLocationsCount: snapshot.countryLocations,
      ruCityBlocksCount: snapshot.ruCityBlocks,
      datasetFingerprint: snapshot.datasetFingerprint,
      ipv4AddressCount: snapshot.ipv4Addresses,
      ipv6AddressCount: snapshot.ipv6Addresses,
    })
    .where(eq(datasetState.id, 1));

  invalidateDatasetStateCache();
  logger.info(snapshot, 'Dataset volume snapshot backfilled');
  return snapshot;
}

export function ensureDatasetVolumesInBackground(): void {
  if (backfillRunning) return;

  backfillRunning = true;
  backfillDatasetVolumes()
    .catch((err) => {
      logger.error({ err }, 'Dataset volume backfill failed');
    })
    .finally(() => {
      backfillRunning = false;
    });
}
