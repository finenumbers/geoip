import { describe, it, expect } from 'vitest';
import { maxPlanRowsFromExplain } from './count-estimate.js';

describe('estimateFilteredCount helpers', () => {
  it('extracts max plan rows from nested EXPLAIN nodes', () => {
    const plan = {
      'Plan Rows': 1,
      Plans: [
        {
          'Plan Rows': 10_556_198,
          Plans: [{ 'Plan Rows': 500 }],
        },
      ],
    };
    expect(maxPlanRowsFromExplain(plan)).toBe(10_556_198);
  });
});
