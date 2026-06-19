import type { MetricsResponse } from '@geoip/shared';

export function formatPrometheusMetrics(payload: MetricsResponse): string {
  const lines: string[] = [
    '# HELP geoip_lookup_latency_p95_ms Lookup latency p95 in milliseconds',
    '# TYPE geoip_lookup_latency_p95_ms gauge',
    `geoip_lookup_latency_p95_ms ${payload.latency.lookupP95Ms}`,
    '# HELP geoip_table_query_latency_p95_ms Table query latency p95 in milliseconds (all modes)',
    '# TYPE geoip_table_query_latency_p95_ms gauge',
    `geoip_table_query_latency_p95_ms ${payload.latency.tableQueryP95Ms}`,
    '# HELP geoip_lookup_latency_samples Lookup latency sample count',
    '# TYPE geoip_lookup_latency_samples gauge',
    `geoip_lookup_latency_samples ${payload.latency.sampleCount.lookup}`,
    '# HELP geoip_table_query_latency_samples Table query latency sample count',
    '# TYPE geoip_table_query_latency_samples gauge',
    `geoip_table_query_latency_samples ${payload.latency.sampleCount.tableQuery}`,
    '# HELP geoip_mv_status Materialized view status (1=ready, 0.5=refreshing, 0=unavailable)',
    '# TYPE geoip_mv_status gauge',
    `geoip_mv_status ${payload.mvStatus === 'ready' ? 1 : payload.mvStatus === 'refreshing' ? 0.5 : 0}`,
  ];

  for (const row of payload.latency.tableQueryByMode ?? []) {
    if (row.sampleCount === 0 && row.requestCount === 0) continue;
    const labels = `mode="${row.mode}",filters="${row.filters}"`;
    lines.push(
      '# HELP geoip_table_query_by_mode_latency_p95_ms Browse table query p95 by pagination mode and filters',
      '# TYPE geoip_table_query_by_mode_latency_p95_ms gauge',
      `geoip_table_query_by_mode_latency_p95_ms{${labels}} ${row.p95Ms}`,
      '# HELP geoip_table_query_by_mode_requests_total Browse table query count by mode and filters',
      '# TYPE geoip_table_query_by_mode_requests_total counter',
      `geoip_table_query_by_mode_requests_total{${labels}} ${row.requestCount}`,
    );
  }

  return `${lines.join('\n')}\n`;
}
