/**
 * Merge overlapping/adjacent IPv4 [start,end] ranges and sum unique addresses.
 * Preceded by a CTE named ipv4_ranges(start_ip bigint, end_ip bigint).
 */
export const MERGED_IPV4_SUM_CTES_AND_SELECT = `
merged_ordered AS (
  SELECT
    start_ip,
    end_ip,
    MAX(end_ip) OVER (
      ORDER BY start_ip, end_ip
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS max_end_before
  FROM ipv4_ranges
  WHERE start_ip IS NOT NULL
    AND end_ip IS NOT NULL
    AND end_ip >= start_ip
),
merged_marked AS (
  SELECT
    start_ip,
    end_ip,
    CASE
      WHEN max_end_before IS NULL OR start_ip > max_end_before + 1 THEN 1
      ELSE 0
    END AS is_new_group
  FROM merged_ordered
),
merged_grouped AS (
  SELECT
    start_ip,
    end_ip,
    SUM(is_new_group) OVER (ORDER BY start_ip, end_ip) AS grp
  FROM merged_marked
),
merged_spans AS (
  SELECT MIN(start_ip) AS start_ip, MAX(end_ip) AS end_ip
  FROM merged_grouped
  GROUP BY grp
)
SELECT COALESCE(SUM(end_ip - start_ip + 1), 0)::text AS ipv4_addresses
FROM merged_spans
`;

/** Full IPv4 space size — unique counts above this are impossible / inflated. */
export const IPV4_SPACE_SIZE = 4_294_967_296n;

export function ipv4CountLooksInflated(value: string | number | null | undefined): boolean {
  if (value == null || value === '') return false;
  try {
    const n = BigInt(String(value).split('.')[0] ?? '0');
    return n > IPV4_SPACE_SIZE;
  } catch {
    return false;
  }
}

/**
 * GRChC address space: unique IPv4 from country blocks (canonical geo layer).
 * City/ASN layers overlap the same space and must not be summed together.
 * IPv6: capacities of distinct country IPv6 prefixes.
 */
export const ADDRESS_SPACE_COUNT_SQL = `
  WITH ipv4_count AS (
    WITH ipv4_ranges AS (
      SELECT
        (network(b.network::inet) - '0.0.0.0'::inet)::bigint AS start_ip,
        (broadcast(b.network::inet) - '0.0.0.0'::inet)::bigint AS end_ip
      FROM geo_country_blocks b
      WHERE family(b.network) = 4
    ),
    ${MERGED_IPV4_SUM_CTES_AND_SELECT}
  ),
  ipv6_count AS (
    SELECT COALESCE(SUM(POWER(2::numeric, 128 - masklen(network))), 0)::text AS ipv6_addresses
    FROM (
      SELECT DISTINCT network::inet AS network
      FROM geo_country_blocks
      WHERE family(network) = 6
    ) v6
  )
  SELECT
    ipv4_count.ipv4_addresses,
    ipv6_count.ipv6_addresses
  FROM ipv4_count
  CROSS JOIN ipv6_count
`;

/** RIR unique IPv4: merge all ipv4 delegated ranges across registries/statuses. */
export const RIR_UNIQUE_IPV4_SQL = `
  WITH ipv4_ranges AS (
    SELECT
      (start_ip::inet - '0.0.0.0'::inet)::bigint AS start_ip,
      CASE
        WHEN end_ip IS NOT NULL AND BTRIM(end_ip) <> ''
          THEN (BTRIM(end_ip)::inet - '0.0.0.0'::inet)::bigint
        ELSE (start_ip::inet - '0.0.0.0'::inet)::bigint + host_count::bigint - 1
      END AS end_ip
    FROM rir_delegations
    WHERE resource_type = 'ipv4'
      AND start_ip IS NOT NULL
      AND host_count IS NOT NULL
      AND host_count::numeric >= 1
  ),
  ${MERGED_IPV4_SUM_CTES_AND_SELECT}
`;
