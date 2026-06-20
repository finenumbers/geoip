import { describe, expect, it, vi } from 'vitest';
import { queryTable } from './table-service.js';

vi.mock('../db/client.js', () => ({
  query: vi.fn(),
}));

vi.mock('../sql/asn-mapping-status.js', () => ({
  isAsnMappingReady: vi.fn().mockResolvedValue(true),
}));

vi.mock('../sql/asn-enrichment.js', () => ({
  batchLookupAsn: vi.fn().mockResolvedValue(new Map()),
  loadPrecomputedAsn: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../repositories/dataset-repository.js', () => ({
  getDatasetState: vi.fn().mockResolvedValue({
    datasetDate: '2026-06-19',
    mvRefreshedAt: null,
    cityRowCount: 1000,
    countryRowCount: 100,
    filterCountCache: { city: { country_iso_code: {} }, country: { country_iso_code: {} } },
  }),
}));

vi.mock('../sql/table-query.js', () => ({
  buildTableQuery: vi.fn(() => ({
    sql: 'SELECT 1',
    countSql: null,
    params: [],
    countParams: [],
    useCachedCount: true,
    skipExactCount: false,
  })),
  supportsKeysetPagination: vi.fn((sort) => sort.length <= 1),
  resolvePaginationMode: vi.fn(() => 'keyset'),
  resolveTableSortHint: vi.fn(() => null),
  resolveSortOverrideHint: vi.fn(() => null),
}));

describe('queryTable profile validation', () => {
  it('returns error for unknown filter field', async () => {
    const result = await queryTable('city', {
      page: 1,
      pageSize: 25,
      sort: [],
      filters: [{ field: 'invalid_field', op: 'eq', value: 'x' }],
    });
    expect(result).toHaveProperty('error');
  });

  it('returns error for city_name sort on country table', async () => {
    const result = await queryTable('country', {
      page: 1,
      pageSize: 25,
      sort: [{ field: 'city_name', dir: 'asc' }],
      filters: [],
    });
    expect(result).toHaveProperty('error');
  });
});
