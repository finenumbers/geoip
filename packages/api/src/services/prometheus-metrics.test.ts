import { describe, expect, it } from 'vitest';
import { formatPrometheusMetrics } from './prometheus-metrics.js';

describe('formatPrometheusMetrics', () => {
  it('renders gauge lines for core metrics', () => {
    const text = formatPrometheusMetrics({
      activeDatasetDate: '2026-06-19',
      mvStatus: 'ready',
      import: { latestBenchmark: null },
      latency: {
        lookupP95Ms: 12,
        tableQueryP95Ms: 34,
        sampleCount: { lookup: 5, tableQuery: 8 },
        tableQueryByMode: [
          { mode: 'keyset', filters: 'none', p95Ms: 8, sampleCount: 3, requestCount: 10 },
          { mode: 'offset', filters: 'active', p95Ms: 120, sampleCount: 2, requestCount: 4 },
        ],
      },
      pgStatStatements: null,
      timestamp: '2026-06-19T00:00:00.000Z',
    });

    expect(text).toContain('geoip_lookup_latency_p95_ms 12');
    expect(text).toContain('geoip_table_query_latency_p95_ms 34');
    expect(text).toContain('geoip_mv_status 1');
    expect(text).toContain('geoip_table_query_by_mode_latency_p95_ms{mode="keyset",filters="none"} 8');
    expect(text).toContain('geoip_table_query_by_mode_requests_total{mode="offset",filters="active"} 4');
  });
});
