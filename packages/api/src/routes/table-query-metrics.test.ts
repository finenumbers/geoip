import { describe, expect, it, beforeEach } from 'vitest';
import {
  getTableQueryByModeMetrics,
  recordTableQueryMetric,
  resetTableQueryMetricsForTests,
} from './table-query-metrics.js';

describe('table-query-metrics', () => {
  beforeEach(() => {
    resetTableQueryMetricsForTests();
  });

  it('tracks p95 and counts per mode/filters bucket', () => {
    recordTableQueryMetric({ queryMs: 10, mode: 'keyset', hasFilters: false });
    recordTableQueryMetric({ queryMs: 20, mode: 'keyset', hasFilters: false });
    recordTableQueryMetric({ queryMs: 100, mode: 'offset', hasFilters: true });
    recordTableQueryMetric({ queryMs: 200, mode: 'offset', hasFilters: true });

    const rows = getTableQueryByModeMetrics();
    const keysetNone = rows.find((r) => r.mode === 'keyset' && r.filters === 'none');
    const offsetActive = rows.find((r) => r.mode === 'offset' && r.filters === 'active');

    expect(keysetNone?.requestCount).toBe(2);
    expect(keysetNone?.p95Ms).toBe(20);
    expect(offsetActive?.requestCount).toBe(2);
    expect(offsetActive?.p95Ms).toBe(200);
  });
});
