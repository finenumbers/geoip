import { query } from '../db/client.js';

interface ExplainPlanNode {
  'Plan Rows'?: number;
  Plans?: ExplainPlanNode[];
}

function maxPlanRows(node: ExplainPlanNode): number {
  let max = node['Plan Rows'] ?? 0;
  for (const child of node.Plans ?? []) {
    max = Math.max(max, maxPlanRows(child));
  }
  return max;
}

export function maxPlanRowsFromExplain(node: ExplainPlanNode): number {
  return maxPlanRows(node);
}

/** Estimate filtered row count via EXPLAIN — avoids full COUNT(*) scan on large MVs. */
export async function estimateFilteredCount(
  countSql: string,
  countParams: unknown[],
): Promise<number> {
  const explainResult = await query<{ 'QUERY PLAN': Array<{ Plan: ExplainPlanNode }> }>(
    `EXPLAIN (FORMAT JSON) ${countSql}`,
    countParams,
  );
  const root = explainResult.rows[0]?.['QUERY PLAN']?.[0]?.Plan;
  if (!root) return 0;
  return Math.max(1, Math.round(maxPlanRows(root)));
}
