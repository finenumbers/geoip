import { describe, expect, it } from 'vitest';
import { getNextDailyCronRun } from './next-cron-run.js';

describe('getNextDailyCronRun', () => {
  it('returns same-day run when before scheduled time', () => {
    const from = new Date(2026, 5, 19, 1, 0, 0);
    const next = getNextDailyCronRun('0 3 * * *', from);
    expect(next?.getTime()).toBe(new Date(2026, 5, 19, 3, 0, 0).getTime());
  });

  it('returns next day when after scheduled time', () => {
    const from = new Date(2026, 5, 19, 4, 0, 0);
    const next = getNextDailyCronRun('0 3 * * *', from);
    expect(next?.getTime()).toBe(new Date(2026, 5, 20, 3, 0, 0).getTime());
  });
});
