import type { FastifyInstance } from 'fastify';
import { getDatasetState } from '../repositories/dataset-repository.js';
import { query } from '../db/client.js';
import { getTopPgStatStatements } from '../sql/pg-stat-statements.js';

const metrics = {
  lookupLatencyMs: [] as number[],
  tableQueryLatencyMs: [] as number[],
};

export function recordLookupLatency(ms: number): void {
  metrics.lookupLatencyMs.push(ms);
  if (metrics.lookupLatencyMs.length > 1000) metrics.lookupLatencyMs.shift();
}

export function recordTableQueryLatency(ms: number): void {
  metrics.tableQueryLatencyMs.push(ms);
  if (metrics.tableQueryLatencyMs.length > 1000) metrics.tableQueryLatencyMs.shift();
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/metrics', async () => {
    const state = await getDatasetState();

    const importStats = await query<{
      last_success: string | null;
      avg_duration_ms: number | null;
      total_runs: number;
    }>(
      `SELECT
         MAX(finished_at) FILTER (WHERE status = 'succeeded') AS last_success,
         AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000) FILTER (WHERE status = 'succeeded') AS avg_duration_ms,
         COUNT(*)::int AS total_runs
       FROM import_runs`,
    );

    const row = importStats.rows[0];
    const pgStatStatements = await getTopPgStatStatements(10);

    return {
      activeDatasetDate: state.datasetDate,
      mvStatus: state.mvStatus,
      import: {
        lastSuccess: row?.last_success,
        avgDurationMs: row?.avg_duration_ms,
        totalRuns: row?.total_runs ?? 0,
      },
      latency: {
        lookupP95Ms: percentile(metrics.lookupLatencyMs, 95),
        tableQueryP95Ms: percentile(metrics.tableQueryLatencyMs, 95),
      },
      pgStatStatements,
      timestamp: new Date().toISOString(),
    };
  });
}
