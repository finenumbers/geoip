import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FilterClause } from '@geoip/shared';
import {
  queryExactFilteredRowCount,
  resolveFilteredRowCount,
  resolveImmediateFilteredRowCount,
} from './filter-row-count.js';

const sampleCache = {
  city: { country_iso_code: { IT: 221_911, RU: 10_000_000 } },
  country: { country_iso_code: { IT: 50_000 } },
};

describe('resolveImmediateFilteredRowCount', () => {
  it('returns dataset total when no filters', () => {
    expect(
      resolveImmediateFilteredRowCount('city', [], true, {
        cityRowCount: 20_000_000,
        countryRowCount: 5_000_000,
        filterCountCache: sampleCache,
      }),
    ).toEqual({ totalRows: 20_000_000, countSource: 'cached' });
  });

  it('returns cached ISO filter count', () => {
    const filters: FilterClause[] = [{ field: 'country_iso_code', op: 'eq', value: 'IT' }];
    expect(
      resolveImmediateFilteredRowCount('city', filters, false, {
        cityRowCount: 20_000_000,
        countryRowCount: 5_000_000,
        filterCountCache: sampleCache,
      }),
    ).toEqual({ totalRows: 221_911, countSource: 'cached' });
  });

  it('returns null for non-cacheable filters', () => {
    const filters: FilterClause[] = [{ field: 'country_name', op: 'in', value: ['Италия'] }];
    expect(
      resolveImmediateFilteredRowCount('city', filters, false, {
        cityRowCount: 20_000_000,
        countryRowCount: 5_000_000,
        filterCountCache: sampleCache,
      }),
    ).toBeNull();
  });
});

describe('resolveFilteredRowCount', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses exact COUNT(*) for country_name filters instead of EXPLAIN estimate', async () => {
    const countSql = 'SELECT COUNT(*)::int AS count FROM mv_city_blocks_analytics v WHERE country_name = $1';
    const filters: FilterClause[] = [{ field: 'country_name', op: 'in', value: ['Италия'] }];

    vi.doMock('../sql/asn-mapping-status.js', () => ({
      isAsnMappingReady: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock('../repositories/dataset-repository.js', () => ({
      getDatasetState: vi.fn().mockResolvedValue({
        cityRowCount: 20_000_000,
        countryRowCount: 5_000_000,
        filterCountCache: sampleCache,
      }),
    }));
    vi.doMock('../sql/table-query.js', () => ({
      buildTableQuery: vi.fn().mockReturnValue({
        countSql,
        countParams: ['Италия'],
        useCachedCount: false,
        skipExactCount: false,
      }),
      hasAsnBlocksFilter: vi.fn().mockReturnValue(false),
    }));
    vi.doMock('../db/client.js', () => ({
      query: vi.fn().mockResolvedValue({ rows: [{ count: 221_911 }] }),
    }));

    const { resolveFilteredRowCount: resolveCount } = await import('./filter-row-count.js');
    await expect(resolveCount('city', filters, [])).resolves.toBe(221_911);

    const { query } = await import('../db/client.js');
    expect(query).toHaveBeenCalledWith(countSql, ['Италия']);
  });
});

describe('queryExactFilteredRowCount', () => {
  it('returns count column from query result', async () => {
    vi.doMock('../db/client.js', () => ({
      query: vi.fn().mockResolvedValue({ rows: [{ count: 42 }] }),
    }));
    vi.resetModules();
    const { queryExactFilteredRowCount: queryCount } = await import('./filter-row-count.js');
    await expect(queryCount('SELECT 1', [])).resolves.toBe(42);
  });
});
