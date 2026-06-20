import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadPrecomputedAsn } from './asn-enrichment.js';

vi.mock('../db/client.js', () => ({
  query: vi.fn(),
}));

const { query } = await import('../db/client.js');

describe('loadPrecomputedAsn', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('maps query rows into block id lookup', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [
        { block_id: 10, asn: 13238, asn_org: 'Yandex' },
        { block_id: 20, asn: null, asn_org: null },
      ],
      rowCount: 2,
    } as never);

    const result = await loadPrecomputedAsn('city', [10, 20, 99]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('geo_city_block_asn'),
      [[10, 20, 99]],
    );
    expect(result.get(10)).toEqual({ asn: 13238, asnOrg: 'Yandex' });
    expect(result.get(20)).toEqual({ asn: null, asnOrg: null });
    expect(result.has(99)).toBe(false);
  });

  it('returns empty map for empty ids without querying', async () => {
    const result = await loadPrecomputedAsn('country', []);
    expect(result.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
