import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({
  query: vi.fn(),
}));

vi.mock('../repositories/rir-repository.js', () => ({
  getRirDatasetState: vi.fn(),
}));

const { query } = await import('../db/client.js');
const { getRirDatasetState } = await import('../repositories/rir-repository.js');
const { lookupRirByIp } = await import('./rir-lookup.js');

describe('lookupRirByIp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRirDatasetState).mockResolvedValue({
      status: 'ready',
      lastSuccessAt: null,
      lastSnapshotDate: '2026-07-01',
      rowCount: 1,
      rowsByRegistry: {},
      rowsByStatus: {},
      snapshotsByRegistry: {},
      lastError: null,
      activeImportRunId: null,
      tableSizeBytes: null,
      volumes: { totalRows: 1, ipv4Addresses: '0' },
    });
  });

  it('rejects invalid IP', async () => {
    const result = await lookupRirByIp('not-an-ip');
    expect(result).toEqual({ error: 'Invalid IP address' });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns null delegation when no covering row', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });
    const result = await lookupRirByIp('8.8.8.8');
    expect(result).toMatchObject({
      ip: '8.8.8.8',
      delegation: null,
      meta: { snapshotDate: '2026-07-01' },
    });
  });

  it('maps covering delegation row', async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [
        {
          registry: 'apnic',
          cc: 'AU',
          status: 'allocated',
          resource_type: 'ipv4',
          range_text: '1.1.1.0/24',
          network: '1.1.1.0/24',
          prefix_len: 24,
          ip_family: 4,
          allocated_at: '2011-08-11',
          opaque_id: 'A91872ED',
          start_asn: null,
          asn_count: null,
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const result = await lookupRirByIp('1.1.1.1');
    expect(result).toMatchObject({
      ip: '1.1.1.1',
      delegation: {
        registry: 'apnic',
        cc: 'AU',
        status: 'allocated',
        resourceType: 'ipv4',
        rangeText: '1.1.1.0/24',
        network: '1.1.1.0/24',
        prefixLen: 24,
        ipFamily: 4,
        allocatedAt: '2011-08-11',
        opaqueId: 'A91872ED',
        startAsn: null,
        asnCount: null,
      },
    });
  });
});
