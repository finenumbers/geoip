import { query } from '../db/client.js';

export type PgStatStatementRow = {
  query: string;
  calls: number;
  totalExecTimeMs: number;
  meanExecTimeMs: number;
};

export async function getTopPgStatStatements(limit = 10): Promise<PgStatStatementRow[] | null> {
  try {
    const result = await query<{
      query: string;
      calls: number;
      total_exec_time: number;
      mean_exec_time: number;
    }>(
      `SELECT
         LEFT(query, 200) AS query,
         calls::int,
         ROUND(total_exec_time::numeric, 2) AS total_exec_time,
         ROUND(mean_exec_time::numeric, 2) AS mean_exec_time
       FROM pg_stat_statements
       WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
       ORDER BY total_exec_time DESC
       LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => ({
      query: row.query,
      calls: row.calls,
      totalExecTimeMs: Number(row.total_exec_time),
      meanExecTimeMs: Number(row.mean_exec_time),
    }));
  } catch {
    return null;
  }
}
