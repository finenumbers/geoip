import { query } from '../db/client.js';

export async function materializedViewsHaveSortRanks(): Promise<boolean> {
  const result = await query<{ has_rank: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mv_city_blocks_analytics'
         AND column_name = 'country_name_rank'
     ) AS has_rank`,
  );
  return result.rows[0]?.has_rank ?? false;
}
