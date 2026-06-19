import { query } from '../db/client.js';

const BATCH_LOOKUP_SIZE = 500;

const BATCH_ASN_LOOKUP_SQL = `
  SELECT
    n.network,
    asn.asn,
    asn.asn_org
  FROM unnest($1::text[]) AS n(network)
  LEFT JOIN LATERAL (
    SELECT
      ab.autonomous_system_number AS asn,
      ab.autonomous_system_organization AS asn_org
    FROM geo_asn_blocks ab
    WHERE ab.network >>= n.network::cidr
    ORDER BY masklen(ab.network) DESC
    LIMIT 1
  ) asn ON true
`;

export async function batchLookupAsn(
  networks: string[],
): Promise<Map<string, { asn: number | null; asnOrg: string | null }>> {
  const result = new Map<string, { asn: number | null; asnOrg: string | null }>();
  if (networks.length === 0) return result;

  const unique = [...new Set(networks)];

  for (let i = 0; i < unique.length; i += BATCH_LOOKUP_SIZE) {
    const chunk = unique.slice(i, i + BATCH_LOOKUP_SIZE);
    const rows = await query<{
      network: string;
      asn: number | null;
      asn_org: string | null;
    }>(BATCH_ASN_LOOKUP_SQL, [chunk]);

    for (const row of rows.rows) {
      result.set(row.network, {
        asn: row.asn != null ? Number(row.asn) : null,
        asnOrg: row.asn_org ?? null,
      });
    }
  }

  return result;
}

export async function loadPrecomputedAsn(
  tableType: 'city' | 'country',
  ids: number[],
): Promise<Map<number, { asn: number | null; asnOrg: string | null }>> {
  const result = new Map<number, { asn: number | null; asnOrg: string | null }>();
  if (ids.length === 0) return result;

  const table = tableType === 'city' ? 'geo_city_block_asn' : 'geo_country_block_asn';
  const idColumn = tableType === 'city' ? 'city_block_id' : 'country_block_id';
  const rows = await query<{
    block_id: number;
    asn: number | null;
    asn_org: string | null;
  }>(
    `SELECT ${idColumn} AS block_id, asn, asn_org
     FROM ${table}
     WHERE ${idColumn} = ANY($1::bigint[])`,
    [ids],
  );

  for (const row of rows.rows) {
    result.set(Number(row.block_id), {
      asn: row.asn != null ? Number(row.asn) : null,
      asnOrg: row.asn_org,
    });
  }

  return result;
}
