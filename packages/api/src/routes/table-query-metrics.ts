export type TableQueryMode = 'keyset' | 'offset';
export type TableQueryFilterScope = 'none' | 'active';

export type TableQueryByModeMetric = {
  mode: TableQueryMode;
  filters: TableQueryFilterScope;
  p95Ms: number;
  sampleCount: number;
  requestCount: number;
};

const MAX_SAMPLES_PER_BUCKET = 500;

const latencyBuckets = new Map<string, number[]>();
const requestCounts = new Map<string, number>();

function bucketKey(mode: TableQueryMode, filters: TableQueryFilterScope): string {
  return `${mode}:${filters}`;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function recordTableQueryMetric(input: {
  queryMs: number;
  mode: TableQueryMode;
  hasFilters: boolean;
}): void {
  const filters: TableQueryFilterScope = input.hasFilters ? 'active' : 'none';
  const key = bucketKey(input.mode, filters);

  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);

  const samples = latencyBuckets.get(key) ?? [];
  samples.push(input.queryMs);
  if (samples.length > MAX_SAMPLES_PER_BUCKET) samples.shift();
  latencyBuckets.set(key, samples);
}

export function getTableQueryByModeMetrics(): TableQueryByModeMetric[] {
  const modes: TableQueryMode[] = ['keyset', 'offset'];
  const filterScopes: TableQueryFilterScope[] = ['none', 'active'];
  const rows: TableQueryByModeMetric[] = [];

  for (const mode of modes) {
    for (const filters of filterScopes) {
      const key = bucketKey(mode, filters);
      const samples = latencyBuckets.get(key) ?? [];
      rows.push({
        mode,
        filters,
        p95Ms: percentile(samples, 95),
        sampleCount: samples.length,
        requestCount: requestCounts.get(key) ?? 0,
      });
    }
  }

  return rows;
}

/** Test helper — resets in-memory browse metrics. */
export function resetTableQueryMetricsForTests(): void {
  latencyBuckets.clear();
  requestCounts.clear();
}
