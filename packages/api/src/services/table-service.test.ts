import { describe, expect, it, vi } from 'vitest';
import { queryTable, seekTablePage } from './table-service.js';

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
  buildTableQuery: vi.fn((tableType, opts) => ({
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
  getFilterMetadataFields: vi.fn(() => []),
  getFilterMetadataSource: vi.fn(() => 'field'),
}));

const { query } = await import('../db/client.js');

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

describe('seekTablePage', () => {
  it('returns page 1 cursor without walking', async () => {
    const result = await seekTablePage('city', { targetPage: 1, pageSize: 50 });
    expect(result).toEqual({
      cursor: null,
      cursorStack: [null],
      seekMs: 0,
      pagesWalked: 0,
      startPage: 1,
    });
  });

  it('rejects unsupported multi-sort seek', async () => {
    const result = await seekTablePage('city', {
      targetPage: 3,
      pageSize: 50,
      sort: [
        { field: 'country_name', dir: 'asc' },
        { field: 'city_name', dir: 'asc' },
      ],
    });
    expect(result).toHaveProperty('error');
  });

  it('walks pages server-side to target cursor', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [{ id: 100, network: '1.0.0.0/8', prefix_len: 8, country_name_rank: 1 }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 200, network: '2.0.0.0/8', prefix_len: 8, country_name_rank: 2 }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

    const result = await seekTablePage('city', {
      targetPage: 3,
      pageSize: 50,
      sort: [{ field: 'country_name', dir: 'desc' }],
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.pagesWalked).toBe(2);
    expect(result.cursor).toEqual({
      afterId: 200,
      afterNetwork: '2.0.0.0/8',
      afterSortValue: '2',
    });
  });
});
