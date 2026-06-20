import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDatasetState } from '../repositories/dataset-repository.js';
import { getImportRunById } from '../repositories/dataset-repository.js';
import { getDb } from '../db/client.js';
import { importRunSteps } from '../db/schema.js';
import { getTopPgStatStatements } from '../sql/pg-stat-statements.js';
import type { MetricsResponse } from '@geoip/shared';
import {
  getTableQueryByModeMetrics,
  recordTableQueryMetric as recordTableQueryMetricBucket,
  type TableQueryFilterScope,
  type TableQueryMode,
} from './table-query-metrics.js';

export type { TableQueryFilterScope, TableQueryMode };

const metrics = {
  lookupLatencyMs: [] as number[],
  tableQueryLatencyMs: [] as number[],
};

export function recordLookupLatency(ms: number): void {
  metrics.lookupLatencyMs.push(ms);
  if (metrics.lookupLatencyMs.length > 1000) metrics.lookupLatencyMs.shift();
}

export function recordTableQueryMetric(input: {
  queryMs: number;
  mode: TableQueryMode;
  hasFilters: boolean;
}): void {
  recordTableQueryMetricBucket(input);
  metrics.tableQueryLatencyMs.push(input.queryMs);
  if (metrics.tableQueryLatencyMs.length > 1000) metrics.tableQueryLatencyMs.shift();
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function getActiveImportBenchmark(activeImportRunId: string | null) {
  if (!activeImportRunId) return null;

  const run = await getImportRunById(activeImportRunId);
  if (!run || run.status !== 'succeeded' || !run.startedAt || !run.finishedAt) {
    return null;
  }

  const db = getDb();
  const steps = await db
    .select()
    .from(importRunSteps)
    .where(eq(importRunSteps.importRunId, activeImportRunId))
    .orderBy(importRunSteps.id);

  return {
    importRunId: run.id,
    datasetDate: run.datasetDate ?? null,
    wallMs: new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime(),
    steps: steps.map((step) => ({
      name: step.name,
      status: step.status,
      durationMs: step.durationMs,
      rows: step.rows,
      message: step.message,
    })),
  };
}

async function buildMetricsResponse(): Promise<MetricsResponse> {
  const state = await getDatasetState();
  const latestBenchmark = await getActiveImportBenchmark(state.activeImportRunId);
  const pgStatStatements = await getTopPgStatStatements(10);

  return {
    activeDatasetDate: state.datasetDate,
    mvStatus: state.mvStatus,
    import: {
      latestBenchmark,
    },
    latency: {
      lookupP95Ms: percentile(metrics.lookupLatencyMs, 95),
      tableQueryP95Ms: percentile(metrics.tableQueryLatencyMs, 95),
      sampleCount: {
        lookup: metrics.lookupLatencyMs.length,
        tableQuery: metrics.tableQueryLatencyMs.length,
      },
      tableQueryByMode: getTableQueryByModeMetrics(),
    },
    pgStatStatements,
    timestamp: new Date().toISOString(),
  };
}

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/metrics', { preHandler: [app.verifyApiKeyIfEnabled] }, async () => {
    return buildMetricsResponse();
  });
}
