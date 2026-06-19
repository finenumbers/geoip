import { query } from '../db/client.js';

const TTL_MS = 30_000;

let cache: { ready: boolean; checkedAt: number } | null = null;

export async function isAsnMappingReady(): Promise<boolean> {
  const now = Date.now();
  if (cache != null && now - cache.checkedAt < TTL_MS) {
    return cache.ready;
  }

  const result = await query<{ ready: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM geo_city_block_asn LIMIT 1) AS ready`,
  );
  const ready = result.rows[0]?.ready ?? false;
  cache = { ready, checkedAt: now };
  return ready;
}

export function invalidateAsnMappingCache(): void {
  cache = null;
}

export function markAsnMappingReady(): void {
  cache = { ready: true, checkedAt: Date.now() };
}
