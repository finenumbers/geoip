import type { RirLookupResponse } from '@geoip/shared';
import { rirLookupRequestSchema } from '@geoip/shared';
import { query } from '../db/client.js';
import { getRirDatasetState } from '../repositories/rir-repository.js';
import { validateIp } from './lookup.js';

interface DelegationRow {
  registry: string;
  cc: string | null;
  status: string;
  resource_type: string;
  range_text: string;
  network: string | null;
  prefix_len: number | null;
  ip_family: number | null;
  allocated_at: string | null;
  opaque_id: string | null;
  start_asn: number | null;
  asn_count: number | null;
}

export async function lookupRirByIp(
  rawIp: string,
): Promise<RirLookupResponse | { error: string }> {
  const parsed = rirLookupRequestSchema.safeParse({ ip: rawIp });
  if (!parsed.success) {
    return { error: 'Invalid request' };
  }

  const ip = validateIp(parsed.data.ip);
  if (!ip) {
    return { error: 'Invalid IP address' };
  }

  const [state, result] = await Promise.all([
    getRirDatasetState(),
    query<DelegationRow>(
      `SELECT registry, cc, status, resource_type, range_text,
              network::text AS network, prefix_len, ip_family,
              allocated_at::text AS allocated_at, opaque_id,
              start_asn, asn_count
       FROM rir_delegations
       WHERE resource_type IN ('ipv4', 'ipv6')
         AND network IS NOT NULL
         AND network >>= $1::inet
       ORDER BY masklen(network) DESC
       LIMIT 1`,
      [ip],
    ),
  ]);

  const row = result.rows[0];
  return {
    ip,
    delegation: row
      ? {
          registry: row.registry,
          cc: row.cc,
          status: row.status,
          resourceType: row.resource_type,
          rangeText: row.range_text,
          network: row.network,
          prefixLen: row.prefix_len,
          ipFamily: row.ip_family,
          allocatedAt: row.allocated_at,
          opaqueId: row.opaque_id,
          startAsn: row.start_asn != null ? Number(row.start_asn) : null,
          asnCount: row.asn_count != null ? Number(row.asn_count) : null,
        }
      : null,
    meta: {
      snapshotDate: state.lastSnapshotDate,
      queriedAt: new Date().toISOString(),
    },
  };
}
