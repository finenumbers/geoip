import { describe, expect, it } from 'vitest';
import { buildAsnFacetQuery, buildAsnTableQuery } from './asn-table-query.js';

describe('buildAsnTableQuery', () => {
  it('filters by asn and asn_org on geo_asn_blocks', () => {
    const built = buildAsnTableQuery({
      filters: [
        { field: 'asn', op: 'eq', value: '15169' },
        { field: 'asn_org', op: 'contains', value: 'Google' },
      ],
      sort: [{ field: 'network', dir: 'asc' }],
      limit: 50,
      offset: 0,
    });
    expect(built.sql).toContain('FROM geo_asn_blocks');
    expect(built.sql).toContain('autonomous_system_number = $');
    expect(built.sql).toContain('autonomous_system_organization::text ILIKE $');
    expect(built.sql).toContain('masklen(network) AS prefix_len');
    expect(built.countSql).toContain('COUNT(*)');
    expect(built.countParams).toEqual([15169, '%Google%']);
  });

  it('filters by ip_family and prefix_len', () => {
    const built = buildAsnTableQuery({
      filters: [
        { field: 'ip_family', op: 'in', value: ['4', '6'] },
        { field: 'prefix_len', op: 'eq', value: '24' },
      ],
      sort: [{ field: 'asn', dir: 'desc' }],
      limit: 20,
      offset: 40,
    });
    expect(built.sql).toContain('ip_family = ANY');
    expect(built.sql).toContain('masklen(network) = $');
    expect(built.sql).toContain('ORDER BY autonomous_system_number DESC');
    expect(built.params).toContainEqual([4, 6]);
    expect(built.params).toContain(24);
    expect(built.params).toContain(20);
    expect(built.params).toContain(40);
  });

  it('uses (network, id) keyset when sort is empty but cursor is set', () => {
    const built = buildAsnTableQuery({
      filters: [],
      sort: [],
      limit: 100,
      offset: 0,
      afterId: 42,
      afterSortValue: '1.0.0.0/24',
    });
    expect(built.sql).toContain('(network::text, id)');
    expect(built.sql).not.toMatch(/id > \$/);
    expect(built.params).toEqual(['1.0.0.0/24', 42, 100]);
  });
});

describe('buildAsnFacetQuery', () => {
  it('groups by asn_org with context filters', () => {
    const built = buildAsnFacetQuery(
      'asn_org',
      'goog',
      20,
      [{ field: 'ip_family', op: 'eq', value: '4' }],
    );
    expect(built.sql).toContain('GROUP BY autonomous_system_organization');
    expect(built.params).toContain(4);
    expect(built.params).toContain('%goog%');
  });
});
