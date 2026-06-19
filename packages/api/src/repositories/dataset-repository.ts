import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  datasetState,
  importRuns,
  importRunSteps,
} from '../db/schema.js';
import type { ImportRun } from '@geoip/shared';
import {
  parseFilterCountCache,
} from '../sql/filter-count-cache.js';
import {
  parseFacetCountCache,
} from '../sql/facet-count-cache.js';

const DATASET_STATE_CACHE_MS = 60_000;

type DatasetStateSnapshot = {
  datasetDate: string | null;
  activatedAt: string | null;
  activeImportRunId: string | null;
  mvStatus: 'ready' | 'refreshing' | 'unavailable';
  mvRefreshedAt: string | null;
  cityRowCount: number;
  countryRowCount: number;
  filterCountCache: ReturnType<typeof parseFilterCountCache>;
  facetCountCache: ReturnType<typeof parseFacetCountCache>;
};

let cachedState: { data: DatasetStateSnapshot; at: number } | null = null;

/** Worker invalidates cache in-process only; API must not serve stale mvStatus=refreshing after import. */
export function isDatasetStateCacheUsable(
  cached: { data: DatasetStateSnapshot; at: number } | null,
  now: number,
  ttlMs: number = DATASET_STATE_CACHE_MS,
): boolean {
  if (!cached) return false;
  if (now - cached.at >= ttlMs) return false;
  if (cached.data.mvStatus === 'refreshing') return false;
  return true;
}

export function invalidateDatasetStateCache(): void {
  cachedState = null;
}

async function loadDatasetStateFromDb(): Promise<DatasetStateSnapshot> {
  const db = getDb();
  const [state] = await db.select().from(datasetState).where(eq(datasetState.id, 1)).limit(1);

  return {
    datasetDate: state?.datasetDate ?? null,
    activatedAt: state?.activatedAt?.toISOString() ?? null,
    activeImportRunId: state?.activeImportRunId ?? null,
    mvStatus: (state?.mvStatus ?? 'unavailable') as 'ready' | 'refreshing' | 'unavailable',
    mvRefreshedAt: state?.mvRefreshedAt?.toISOString() ?? null,
    cityRowCount: state?.cityRowCount ?? 0,
    countryRowCount: state?.countryRowCount ?? 0,
    filterCountCache: parseFilterCountCache(state?.filterCountCache),
    facetCountCache: parseFacetCountCache(state?.facetCountCache),
  };
}

export async function getDatasetState(): Promise<DatasetStateSnapshot> {
  const now = Date.now();
  if (isDatasetStateCacheUsable(cachedState, now)) {
    return cachedState!.data;
  }

  const data = await loadDatasetStateFromDb();
  cachedState = { data, at: now };
  return data;
}

export async function listImportRuns(limit = 50, offset = 0) {
  const db = getDb();
  const items = await db
    .select()
    .from(importRuns)
    .orderBy(desc(importRuns.startedAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(importRuns);

  const total = countResult[0]?.count ?? 0;

  return {
    items: items.map(mapImportRun),
    total,
  };
}

export async function getImportRunById(id: string): Promise<ImportRun | null> {
  const db = getDb();
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, id)).limit(1);
  if (!run) return null;

  const steps = await db
    .select()
    .from(importRunSteps)
    .where(eq(importRunSteps.importRunId, id))
    .orderBy(importRunSteps.id);

  return {
    ...mapImportRun(run),
    steps: steps.map((s) => ({
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
      rows: s.rows,
      message: s.message,
    })),
  };
}

export async function getRunningImport() {
  const db = getDb();
  const [run] = await db
    .select()
    .from(importRuns)
    .where(
      sql`${importRuns.status} IN ('queued', 'running', 'validating', 'swapping', 'refreshing_mv')`,
    )
    .limit(1);
  return run ?? null;
}

function mapImportRun(run: typeof importRuns.$inferSelect): ImportRun {
  return {
    id: run.id,
    datasetDate: run.datasetDate ?? null,
    status: run.status,
    triggeredBy: run.triggeredBy,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    counts: {
      cityBlocks: run.rowsCityBlocks,
      countryBlocks: run.rowsCountryBlocks,
      asnBlocks: run.rowsAsnBlocks,
      rejected: run.rowsRejected,
    },
  };
}
